// node library/test/store.test.mjs
//
// THE LIBRARY'S STORE, without a browser (library/store.js): every built-in item -- the + menu's entries
// and the assembly files -- goes into a fresh scene and leaves it sound (model.js validate), keeping its
// size across units; the user's items are added, renamed, removed and survive an export and import;
// search finds by name, category, tags and help; tags are words, each once, and filter all together; any item
// duplicates into one's own, and one's own change; and what the library cannot hold is refused with why.
import { readFileSync } from 'node:fs'
import * as M from '../../builder/model.js'
import { createLibrary, memoryBackend, search, problemOf, KINDS, FORMAT, normalTags, tagCounts } from '../store.js'
import { ITEM_FILES, itemUrl } from '../items/index.js'
import { PRIMITIVES, SHAPE_GROUPS } from '../../builder/primitives.js'
import { MODIFIERS } from '../../builder/modifiers.js'
import { LIGHT_SHAPES } from '../../builder/lights.js'
import { PRESETS } from '../../builder/materials.js'
import { literalsIn } from '../../builder/test/literals.mjs'
import { canon } from '../edit.js'
import { sampleShape, SAMPLE_SHAPE_KEYS, SAMPLE_SIZES } from '../studio.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)

const load = f => JSON.parse(readFileSync(itemUrl(f), 'utf8'))
const L = createLibrary({ model: M, backend: memoryBackend(), files: ITEM_FILES, load })
const all = await L.list()
const menu = Object.keys(PRIMITIVES).length + Object.keys(MODIFIERS).length + Object.keys(LIGHT_SHAPES).length + Object.keys(PRESETS).length
ok('every + menu entry is an item', all.filter(i => !i.id.includes(':file:')).length === menu, `${all.length} items, ${menu} menu entries`)
ok('...and the assembly files add theirs', all.some(i => i.name.startsWith('Optics bench')) && all.some(i => i.name.startsWith('PMMA lens')))
ok('every item has a kind the library knows', all.every(i => KINDS.includes(i.kind)), all.filter(i => !KINDS.includes(i.kind)).map(i => i.name).join())
ok('the kinds come out right', all.find(i => i.id === 'builtin:light:rectangle')?.kind === 'light' && all.find(i => i.id === 'builtin:modifier:twist')?.kind === 'group'
    && all.find(i => i.id === 'builtin:shape:sphere')?.kind === 'object' && all.find(i => i.id === 'builtin:material:glass')?.kind === 'material')

// A MATERIAL'S NUMBERS ARE ITS PARAMETERS: no colour and no length written into a built-in material's code
// (builder/test/literals.mjs) -- they are sliders and uniforms
{
    const mats = all.flatMap(it => [it.asset.kind === 'material' ? it.asset.material : null, ...(it.asset.materials || []),
                                    ...(it.preview?.materials || [])].filter(Boolean).map(m => [it.name, m]))
    const held = mats.map(([name, m]) => [name, [...literalsIn(m.code), ...literalsIn(m.relief?.code)]]).filter(([, l]) => l.length)
    ok('no built-in material\'s code holds a colour or a length: they are its parameters', !held.length, JSON.stringify(held))
    ok('...and the check finds them', JSON.stringify(literalsIn('m.baseColor = mix(VEC3(0.36, 0.2, 0.1), a, t); // VEC3(1.0, 0.5, 0.0)\n'
        + 'let q = p_local * perMm(1.0 / 8.0) / mm(1.0); let s = streaksAlong(q, VEC3(1.0, 0.0, 0.0), metres(0.6 * 0.001), 1.0);'))
        === JSON.stringify(['VEC3(0.36, 0.2, 0.1)', 'perMm(1.0 / 8.0)']), 'not an axis, not mm(1.0), not a comment; metres of a product is an expression')
    // every length a material marks is one of its own numbers, shown in mm
    const lens = mats.flatMap(([name, m]) => (m.lengths || []).filter(k => typeof m.params[k] !== 'number').map(k => `${name}: ${k}`))
    ok('a material\'s lengths are numbers of its own', !lens.length, lens.join(', '))
    /* WHAT EACH IS SHOWN ON: nothing (the 50 mm sphere), one of the studio's sample shapes at one of its sizes,
       or a preview of its own for a reason its help gives -- so a new item cannot pick up a one-off size by
       accident (the leather, the stones and the hammered metal on an 80 mm sphere, brushed aluminium on a
       40 mm one, turned aluminium on the face of a disc) */
    const OWN = ['brushed aluminium', 'turned aluminium', 'leather', 'rough stone', 'hammered metal']
    const std = new Set(SAMPLE_SIZES.flatMap(z => SAMPLE_SHAPE_KEYS.map(k => canon(sampleShape(k, z)))))
    const odd = all.filter(it => it.asset.kind === 'material' && it.preview && !std.has(canon(it.preview)) && !OWN.includes(it.name)).map(it => it.name)
    ok('every built-in material is shown on a standard sample, or on its own for a reason', !odd.length, odd.join(', '))
    const big = n => all.find(it => it.name === n)?.preview
    ok('the large patterns are shown on the 200 mm samples', ['marble', 'rust', 'concrete', 'sandstone']
        .every(n => canon(big(n)) === canon(sampleShape(n === 'marble' || n === 'rust' ? 'sphere' : 'cube', 200))))
}

// EVERY BUILT-IN GOES IN: into a metre scene, sound afterwards
for (const it of all) {
    const doc = M.createDoc()
    try {
        const out = M.insertAsset(doc, it.asset, 'root')
        const bad = M.validate(doc)
        ok(`inserts soundly: ${it.name}`, out && (!bad || !bad.length), JSON.stringify(bad)?.slice(0, 300))
    } catch (e) { ok(`inserts soundly: ${it.name}`, false, e.message) }
}
// ...keeping its size: the centimetre lens in a millimetre scene is ten times the numbers
{
    const lens = all.find(i => i.name.startsWith('PMMA lens'))
    const doc = M.createDoc(); doc.unit = 'mm'
    const n = M.insertAsset(doc, lens.asset, 'root')
    ok('an item from a centimetre scene keeps its size in a millimetre one', Math.abs(n.transform.scale - 10) < 1e-9, `scale ${n.transform.scale}`)
    ok('...and brings its glass', doc.materials.some(m => m.label.startsWith('PMMA')))
}

// SIZE: a generic shape, modifier or light has none of its own -- it lands at 1 unit of the scene, as + makes it
// there -- and an LED, a lens, anything kept from a scene has a real size and keeps it
{
    const inMm = it => { const d = M.createDoc(); d.unit = 'mm'; return M.insertAsset(d, it.asset, 'root') }
    const generic = all.filter(i => /^builtin:(shape|modifier|light):/.test(i.id))
    ok('the + menu\'s shapes, modifiers and lights have no size of their own (unit null)', generic.length > 10 && generic.every(i => i.asset.unit === null))
    ok('...so in a millimetre scene each is at 1 unit, as + makes it there (a library sphere was a metre ball)',
        generic.every(i => inMm(i).transform.scale === 1), generic.filter(i => inMm(i).transform.scale !== 1).map(i => i.name).join())
    const relief = inMm(all.find(i => i.id === 'builtin:modifier:relief'))
    ok('...a noise relief among them: its 0.03 is 0.03 mm, not 30', relief.transform.scale === 1 && relief.params.amount === 0.03)
    const led = all.find(i => i.name.startsWith('LED die'))
    const m = M.createDoc()
    ok('an LED keeps its real size in a metre scene', led.asset.unit !== null && M.insertAsset(m, led.asset, 'root').transform.scale
        === +(M.UNITS[led.asset.unit] * led.asset.node.transform.scale).toPrecision(12), led.asset.unit)
    const d = M.createDoc(); d.unit = 'mm'
    ok('...and what is kept from a scene says the unit it was in: it has a real size', M.extractAsset(d, M.addObject(d, 'root', { primitive: 'sphere' }).id).unit === 'mm')
}

// THE USER'S ITEMS
const doc = M.createDoc()
const sph = M.addObject(doc, 'root', { primitive: 'sphere' })
const mine = await L.add({ name: '  my sphere ', category: 'Tests', tags: ['round'], asset: M.extractAsset(doc, sph.id) })
ok('an item of one\'s own is kept, named without the spaces', mine.source === 'mine' && mine.name === 'my sphere' && mine.kind === 'object')
let after = await L.list()
ok('...and listed after the built-in ones', after.at(-1).id === mine.id)
await L.rename(mine.id, 'ball')
ok('renamed', (await L.list()).find(i => i.id === mine.id)?.name === 'ball')
let threw = null
try { await L.remove('builtin:shape:sphere') } catch (e) { threw = e.message }
ok('a built-in item cannot be removed', /built-in/.test(threw ?? ''))
threw = null
try { await L.add({ name: 'nothing', asset: { kind: 'node' } }) } catch (e) { threw = e.message }
ok('an asset without its node is refused, and says why', /without its node/.test(threw ?? ''), threw)

// EXPORT AND IMPORT: into another library, as new items
const text = await L.exportLibrary()
const j = JSON.parse(text)
ok('the export is a library file of the user\'s items only', j.format === FORMAT && j.items.length === 1 && j.items[0].name === 'ball')
const other = createLibrary({ model: M, backend: memoryBackend() })
const r = await other.importLibrary(text)
const got = (await other.list()).filter(i => i.source === 'mine')
ok('imported into another library', r.added === 1 && got.length === 1 && got[0].name === 'ball' && got[0].id !== mine.id, JSON.stringify(r))
const bad = await other.importLibrary(JSON.stringify({ format: FORMAT, version: 1, items: [{ name: 'x' }, got[0]] }))
ok('an import skips what it cannot hold, saying why, and takes the rest', bad.added === 1 && bad.skipped[0]?.why === 'no asset (a node or a material)', JSON.stringify(bad))
threw = null
try { await other.importLibrary('{"items":[]}') } catch (e) { threw = e.message }
ok('a file that is not a library is refused', /not a library file/.test(threw ?? ''))
await L.remove(mine.id)
ok('removed', !(await L.list()).some(i => i.id === mine.id))

// SEARCH
ok('search by name', search(all, 'sphere').some(i => i.id === 'builtin:shape:sphere'))
ok('search by tag and category, every word', search(all, 'acrylic optics').length === 1)
ok('filter by kind', search(all, '', { kind: 'light' }).every(i => i.kind === 'light') && search(all, '', { kind: 'light' }).length >= 3)
ok('problemOf a good item is null', problemOf(all[0]) === null)

// TAGS: words, lower case, each once -- from a list or a line -- and filtering all together
eq('normalTags trims, lowers and keeps each once, from a line or a list', [normalTags(' Metal, brushed ,metal,,'), normalTags(['A', 'a ', 'b'])], [['metal', 'brushed'], ['a', 'b']])
ok('the built-in files\' tags are each once (materials.json had "metal" twice)', all.every(i => new Set(i.tags).size === i.tags.length),
    all.filter(i => new Set(i.tags).size !== i.tags.length).map(i => i.name).join())
ok('every modifier says which kind it is: space, shape or surface',
    all.filter(i => i.id.startsWith('builtin:modifier:')).every(i => i.tags.length === 1 && ['space', 'shape', 'surface'].includes(i.tags[0])))
ok('several tags narrow: every one must be the item\'s', search(all, '', { tags: ['metal'] }).length > search(all, '', { tags: ['metal', 'brushed'] }).length
    && search(all, '', { tags: ['metal', 'brushed'] }).every(i => i.name.includes('brushed')))
{
    const c = tagCounts(all)
    ok('tagCounts: the most used first, each with how many carry it', c.length > 10 && c.every((x, i) => i === 0 || c[i - 1][1] >= x[1])
        && c.find(([t]) => t === 'metal')[1] === all.filter(i => i.tags.includes('metal')).length, JSON.stringify(c.slice(0, 5)))
}

// DUPLICATE AND UPDATE: any item into one's own, and one's own changed
{
    const L2 = createLibrary({ model: M, backend: memoryBackend(), files: ITEM_FILES, load })
    const brushed = (await L2.list()).find(i => i.name === 'brushed aluminium')
    const dup = await L2.duplicate(brushed.id)
    ok('a built-in item duplicates into one\'s own, "... copy", its category, tags and help with it',
        dup.source === 'mine' && dup.name === 'brushed aluminium copy' && dup.category === brushed.category
        && JSON.stringify(dup.tags) === JSON.stringify(brushed.tags) && dup.help === brushed.help
        && JSON.stringify(dup.asset) === JSON.stringify(brushed.asset))
    const listed = await L2.list()
    // the categories as the panel heads them: a new heading wherever the category changes
    const runs = listed.map(i => i.category).filter((c, k, a) => k === 0 || a[k - 1] !== c)
    ok('one\'s own item in a built-in category is listed right after its built-in ones, under the one heading',
        new Set(runs).size === runs.length && listed.findIndex(i => i.id === dup.id) === listed.findLastIndex(i => i.category === 'Materials'), runs.join())
    const up = await L2.update(dup.id, { name: ' shiny ', tags: 'Metal, shiny', help: 'mine now', category: '' })
    ok('update changes what it is given: name trimmed, tags normalised, an empty category is Mine',
        up.name === 'shiny' && JSON.stringify(up.tags) === '["metal","shiny"]' && up.help === 'mine now' && up.category === 'Mine')
    const asset = structuredClone(up.asset); asset.material.params.roughness = 0.9
    await L2.update(dup.id, { asset })
    ok('...its asset too', (await L2.list()).find(i => i.id === dup.id).asset.material.params.roughness === 0.9)
    let threw = null
    try { await L2.update(brushed.id, { name: 'x' }) } catch (e) { threw = e.message }
    ok('a built-in item is not changed: duplicate it first', /duplicate it first/.test(threw ?? ''), threw)
    threw = null
    try { await L2.update(dup.id, { asset: { kind: 'node' } }) } catch (e) { threw = e.message }
    ok('...nor one\'s own into something the library cannot hold', /without its node/.test(threw ?? '') && (await L2.list()).find(i => i.id === dup.id).asset.kind === 'material', threw)
    threw = null
    try { await L2.update(dup.id, { preview: { kind: 'material' } }) } catch (e) { threw = e.message }
    ok('a preview must be a node asset', /preview/.test(threw ?? ''), threw)
    const again = await L2.duplicate(dup.id)
    ok('one\'s own item duplicates too', again.name === 'shiny copy' && again.id !== dup.id && again.source === 'mine')
}

// A BUILT-IN SHAPE IS TAGGED WITH ITS GROUP (primitives.js SHAPE_GROUPS), so the tag row filters the shapes as the + menu
// groups them; the Fresnel lens is optics and from points both
{
    const shapes = all.filter(i => i.id.startsWith('builtin:shape:'))
    ok('every built-in shape carries its group as a tag', shapes.every(i => i.tags.includes(PRIMITIVES[i.name].group)), shapes.filter(i => !i.tags.includes(PRIMITIVES[i.name]?.group)).map(i => i.name).join())
    const fres = shapes.find(i => i.name === 'fresnel lens')
    ok('...the Fresnel lens, optics and from points', !!fres && fres.tags.includes('optics') && fres.tags.includes('from points'), JSON.stringify(fres?.tags))
    ok('...and the tag filter finds a group\'s shapes', SHAPE_GROUPS.every(g => search(shapes, '', { tags: [g.key] }).length > 0)
        && search(shapes, '', { tags: ['optics'] }).every(i => PRIMITIVES[i.name].group === 'optics' || (PRIMITIVES[i.name].tags || []).includes('optics')))
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
