// node library/test/studio.test.mjs
//
// THE STUDIO'S ARITHMETIC, without a GPU (library/studio.js): the scene an item is pictured in -- a
// material on a sphere, a node as a paste puts it, in the item's own unit -- is a sound document; and the
// camera framing a box looks at its centre from where the sphere around it fits the view. What it
// renders is the user's to judge: the container has no GPU.
import * as M from '../../builder/model.js'
import { createLibrary, memoryBackend } from '../store.js'
import { studioBatch, studioParts, itemKey, floorIdOf, framing, STUDIO, sunAzimuthFor, viewGate, DEFAULT_PREVIEW } from '../studio.js'
import { ITEM_FILES, itemUrl } from '../items/index.js'
import { readFileSync } from 'node:fs'
import { generate } from '../../builder/codegen.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

const items = await createLibrary({ model: M, backend: memoryBackend() }).list()
// ONE SCENE HOLDING EVERY ITEM, each hidden behind its uniform
{
    const B = studioBatch(items, 'm', 3)
    ok('the scene is sound', M.validate(B.doc).length === 0, JSON.stringify(M.validate(B.doc)).slice(0, 300))
    ok('it keeps hidden nodes compiled (live visibility)', B.doc.liveVisibility === true)
    ok('an entry per item', B.entries.size === new Set(items.map(itemKey)).size, `${B.entries.size} of ${items.length}`)
    ok('every item is in it, hidden', [...B.entries.values()].every(e => M.find(B.doc, e.id)?.node.enabled === false))
    ok('its ids are its own (n * 100000 on): no uniform shares a name with another studio scene',
        [...B.entries.values()].every(e => +e.id.replace(/\D/g, '') > 300000) && B.floorId === floorIdOf(3))
    const glass = B.entries.get(itemKey(items.find(i => i.id === 'builtin:material:glass')))
    const g = M.find(B.doc, glass.id).node
    ok('a material is pictured on a sphere of it', M.codeOf(B.doc, g).includes('sphere') && B.doc.materials.find(m => m.id === g.material)?.label === 'glass')
    const sph = M.find(B.doc, B.entries.get(itemKey(items.find(i => i.id === 'builtin:shape:sphere'))).id).node
    ok('an object with no material of its own is the studio\'s white', B.doc.materials.find(m => m.id === sph.material)?.label === 'studio white')
    const tw = M.find(B.doc, B.entries.get(itemKey(items.find(i => i.id === 'builtin:modifier:twist'))).id).node
    ok('an empty modifier gets an F to act on', tw.children.length === 1 && tw.children[0].label === 'example F' && tw.children[0].children.length === 3)
    // no symmetry, and all on +x: a mirror across x = 0 must show two of it, not one shape
    ok('...entirely on the +x side', tw.children[0].children.every(b => b.transform.pos.x - b.params.size.x > 0))
    const entryOf = id => B.entries.get(itemKey(items.find(i => i.id === id)))
    // a mirror doubles the F across x = 0, a repeat copies it: their boxes are known, not estimated
    const mb = entryOf('builtin:modifier:mirror').box
    ok('a mirror\'s picture frames the F and its reflection', mb && mb.lo[0] < -0.5 && mb.hi[0] > 0.5)
    const rp = M.find(B.doc, entryOf('builtin:modifier:repeat').id).node
    ok('a repeat shows its F at a pitch that fits it', rp.params.spacing.x >= 2 * 0.57 && rp.params.count.x === 1)
    ok('...and frames all of its copies', entryOf('builtin:modifier:repeat').box.hi[0] > 1.8)
    ok('another modifier is measured, not estimated', entryOf('builtin:modifier:twist').measure === true)
    // a light shown lit: 1000 cd/m2 beside a sunlit white was black
    const lights = []; M.walk(B.doc, x => { if (x.type === 'light') lights.push(x) })
    ok('every light is shown at the studio\'s luminance', lights.length > 0 && lights.every(l => l.light.luminance === STUDIO.lightLuminance && l.light.flux == null))
    const floor = M.find(B.doc, B.floorId).node
    ok('the floor is shown, and darker than the white', floor.enabled !== false
        && B.doc.materials.find(m => m.id === floor.material).params.baseColor.r < STUDIO.white)
    // what the renderer compiles: every entry declares the uniform the studio writes to show it
    const scene = generate(...M.generateArgs(B.doc, { id: 'studio' }))
    ok('the scene declares vis_<id> for every item', [...B.entries.values()].every(e => scene.uniforms[`vis_${e.id}`]?.def === 0))
    ok('...and the floor\'s transform, radius and height it moves', ['xf', 'radius', 'height'].every(k => scene.uniforms[`${k}_${B.floorId}`]))
}
{
    const it = { name: 'cm box', asset: { ...M.extractAsset((() => { const d = M.createDoc(); d.unit = 'cm'; M.addObject(d, 'root', { primitive: 'box', id: 'b' }); return d })(), 'b') } }
    const B = studioBatch([it], 'cm', 1)
    ok('a unit\'s scene is in that unit, its items unscaled', B.doc.unit === 'cm' && M.find(B.doc, B.entries.get(itemKey(it)).id).node.transform.scale === 1)
}
{
    const f = framing([-1, -1, -1], [1, 1, 1])
    const r = Math.sqrt(3) * STUDIO.margin
    ok('framing looks at the box\'s centre', f.target.every(v => Math.abs(v) < 1e-12))
    ok('...from where its sphere just fills the view', Math.abs(f.distance * Math.sin(STUDIO.fov * Math.PI / 360) - r) < 1e-9, `${f.distance}`)
    const g = framing([10, 0, 0], [10, 0, 0])
    ok('a box of no size still gets a distance (not zero, not NaN)', g.distance > 0 && Number.isFinite(g.distance))
}
// THE SUN: at the camera's left by sunFromCamera, whatever the camera's azimuth
for (const camAz of [-50, 0, 120]) {
    const a = sunAzimuthFor(camAz) * Math.PI / 180, c = camAz * Math.PI / 180
    const sun = [Math.sin(a), Math.cos(a)], cam = [Math.cos(c), Math.sin(c)]          // sdf.js, camera.js
    const turn = Math.atan2(cam[0] * sun[1] - cam[1] * sun[0], cam[0] * sun[0] + cam[1] * sun[1]) * 180 / Math.PI
    ok(`the sun is ${STUDIO.sunFromCamera} degrees round from the camera (camera at ${camAz})`, Math.abs(turn - STUDIO.sunFromCamera) < 1e-9, `${turn}`)
}

// THE VIEW PAUSED while the studio works: once for a run, resumed after the last, at once on release
{
    const tick = ms => new Promise(r => setTimeout(r, ms))
    let running = true, pauses = 0, resumes = 0
    const pauseView = () => { const was = running; running = false; pauses++; return () => { if (was) { running = true; resumes++ } } }
    const G = viewGate(pauseView, 30)
    G.pause(); G.unpause(); G.pause(); G.unpause(); G.pause()
    ok('a run of pictures pauses the view once', pauses === 1 && !running)
    G.unpause(); await tick(10)
    ok('...keeps it paused a moment after the last (the next may follow)', !running)
    await tick(40)
    ok('...and then gives it back', running && resumes === 1)
    G.pause()
    ok('a new run pauses again', !running && pauses === 2)
    G.release()
    ok('release() gives it back at once, mid-run', running && resumes === 2)
    G.unpause(); await tick(40)
    ok('...and the run ending after that does not give it back twice', resumes === 2)
    running = false
    const H = viewGate(pauseView, 5); H.pause(); H.unpause(); await tick(20)
    ok('a view the user had stopped is not started by the studio', !running)
}

// THE PARTS: STUDIO.batch items to a scene per unit, the order kept, a later item joining the last part
{
    const mk = (i, unit = 'm') => ({ id: `t${i}`, name: `t${i}`, asset: { kind: 'node', unit, node: { i } } })
    const P = studioParts(3)
    const first = P.know([mk(0), mk(1), mk(2), mk(3), mk(4), mk(5, 'cm')])
    const partOf = i => P.partOf(itemKey(mk(i)))
    ok('parts of the batch size, in the order given', partOf(0) === partOf(2) && partOf(3) === partOf(4) && partOf(2) !== partOf(3), [0, 1, 2, 3, 4].map(partOf).join())
    ok('...one unit\'s items never share a part with another\'s', P.partOf(itemKey(mk(5, 'cm'))) !== partOf(4))
    ok('...every part new at first', first.size === 3, [...first].join())
    ok('...a part holds its items', P.members(partOf(3)).map(i => i.id).join() === 't3,t4')
    const again = P.add([mk(0), mk(6)])
    ok('an item added joins the last part, and only that part is stale', again.size === 1 && partOf(6) === partOf(3), [...again].join())
    ok('...a full part is not touched', P.members(partOf(0)).length === 3)
    ok('a part says which of how many it is', P.label(partOf(3)) === 'part 2 of 3', P.label(partOf(3)))
    /* THE LIBRARY'S WHOLE LIST FORGETS what it no longer holds: an edited item is a new one, and its old
       self stayed compiled into its part's every scene */
    const was = partOf(1)
    const gone = P.know([mk(0), mk(2), mk(3), mk(4), mk(5, 'cm'), mk(6)])
    ok('know() forgets an item the list no longer has, and its part is stale', !P.has(itemKey(mk(1))) && gone.has(was) && gone.size === 1, [...gone].join())
    ok('...its part holds the rest', P.members(was).map(i => i.id).join() === 't0,t2')
}

// A MATERIAL'S SAMPLE: real size -- a 25 mm sphere, or the item's own -- in whatever unit the part is
{
    const withFiles = await createLibrary({ model: M, backend: memoryBackend(), files: ITEM_FILES,
        load: f => JSON.parse(readFileSync(itemUrl(f), 'utf8')) }).list()
    const glass = withFiles.find(i => i.id === 'builtin:material:glass'), brushed = withFiles.find(i => i.name === 'brushed aluminium'),
          turned = withFiles.find(i => i.name === 'turned aluminium')
    const B = studioBatch([glass, brushed, turned], 'm', 7)
    const node = it => M.find(B.doc, B.entries.get(itemKey(it)).id).node
    const g = node(glass), br = node(brushed), tu = node(turned)
    ok('a material with no sample of its own is shown on a 25 mm sphere, in the part\'s metres',
        g.params.radius === 25 && g.transform.scale === 0.001 && /sphere/.test(M.codeOf(B.doc, g)), JSON.stringify([g.params, g.transform.scale]))
    ok('...one with its own on that: brushed aluminium a 20 mm sphere, turned aluminium the face of a 25 mm disc',
        br.params.radius === 20 && tu.params.radius === 25 && tu.params.height === 10 && /cylinder|Ncylinder/.test(M.codeOf(B.doc, tu)))
    ok('...each wearing its material', [g, br, tu].every(n => B.doc.materials.find(m => m.id === n.material)))
    ok('...a sample of its own is measured, not estimated (a disc is no cube)', B.entries.get(itemKey(turned)).measure === true
        && B.entries.get(itemKey(glass)).measure === false)
    ok('what a material is shown on is part of what the studio knows it by', itemKey(glass) !== itemKey({ ...glass, preview: DEFAULT_PREVIEW }))
    ok('the default sample stands on z = 0', DEFAULT_PREVIEW.node.transform.pos.z === DEFAULT_PREVIEW.node.params.radius)
    ok('the part is sound', M.validate(B.doc).length === 0, JSON.stringify(M.validate(B.doc)).slice(0, 200))
}

// ---- ITEMS FROM TWO SCENES WITH TWO HELPERS OF ONE NAME (model.js insertAsset since 0.15): the second cannot go in
//      beside the first; it fails alone, its neighbours drawn, and the part still compiles
{
    const itemFrom = (body, label) => {
        const d = M.createDoc()
        d.functions = `fn bump(x: f32) -> f32 { return ${body}; }\n`
        M.addObject(d, 'root', { id: 'o', label, code: 'C = add_new(C, sd(length(p) - bump(0.5)), MATERIAL);', params: {} })
        return { name: label, asset: M.extractAsset(d, 'o') }
    }
    const one = itemFrom('x', 'one'), two = itemFrom('x * 2.0', 'two'), plain = { name: 'ball', asset: M.extractAsset((() => {
        const d = M.createDoc(); M.addObject(d, 'root', { id: 's', primitive: 'sphere' }); return d })(), 's') }
    const B = studioBatch([one, two, plain], 'm', 7)
    ok('two helpers of one name in one part: the second item said to fail, the others in', /bump/.test(B.entries.get(itemKey(two))?.failed ?? '')
        && !!B.entries.get(itemKey(one))?.id && !!B.entries.get(itemKey(plain))?.id, JSON.stringify([...B.entries.values()]))
    ok('...and the part sound, compiling the first one\'s helper', M.validate(B.doc).length === 0
        && /fn bump\(x: f32\) -> f32 \{ return x; \}/.test(generate(...M.generateArgs(B.doc, { id: 'studio' })).wgsl))
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
