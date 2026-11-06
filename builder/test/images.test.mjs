// node builder/test/images.test.mjs
//
// PICTURES ON SURFACES, THE BUILDER'S SIDE (model version 29, 0.next; builder/images.js): a scene's pictures and a
// material's slots checked, made, changed and taken away; what changes the shader's text and what is live; a picture
// kept once whoever uses it, in the file only while something does, outside every undo step and carried across a
// restore; carried by an asset into another scene; a file of 28 read; codegen's text byte for byte without one, and with
// one the atlas a resource, a slot a uniform, the glow and the colour wired, the code's names; through the real builder
// over a stand-in renderer, a slot's setting pushed live as its uniform and a new picture a compile. What a picture
// LOOKS like on a surface is the user's to judge (CLAUDE.md); the lookup itself is core/test/images.test.mjs, on the GPU
// builder/test/images.gpu.mjs.
import * as M from '../model.js'
import * as P from '../project.js'
import { generate, uniformName } from '../codegen.js'
import { entryFromBytes, slotKey, imagesProblems, usedImages, SCREEN_DEFAULTS } from '../images.js'
import { slotMatrix, IMAGE_RESOURCE } from '../../lib/pathtracer/core/images.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const threw = f => { try { f(); return null } catch (e) { return e.message } }

const a = await entryFromBytes(new Uint8Array([1, 2, 3, 4]), { name: 'a.png', type: 'image/png', width: 64, height: 32 })
const b = await entryFromBytes(new Uint8Array([9, 8, 7]), { name: 'b.jpg', type: 'image/jpeg', width: 10, height: 30 })
const a2 = await entryFromBytes(new Uint8Array([1, 2, 3, 4]), { name: 'the same bytes.png', type: 'image/png', width: 64, height: 32 })

// ---- a picture's key and entry
ok('a picture keyed by its bytes: the same bytes the same key, whatever its name', a.key === a2.key && a.key !== b.key && /^i[0-9a-f]{24}$/.test(a.key))
ok('its entry: name, type, size and its bytes in base64', a.entry.data === 'AQIDBA==' && a.entry.width === 64 && imagesProblems({ [a.key]: a.entry }).length === 0)
ok('a picture with a wrong key, type, size or a field of its own refused, each said',
    imagesProblems({ x: a.entry }).length === 1 && imagesProblems({ [a.key]: { ...a.entry, type: 'image/gif' } }).length === 1
    && imagesProblems({ [a.key]: { ...a.entry, width: 5000 } }).length === 1 && imagesProblems({ [a.key]: { ...a.entry, pixels: [] } }).length === 1)

// ---- slots on a material
const doc = () => {
    const d = M.createDoc({ title: 'pictures' })
    M.addMaterial(d, { id: 'wall', label: 'wall', preset: 'diffuse' })
    M.addMaterial(d, { id: 'tv', label: 'tv', preset: 'diffuse' })
    M.setMaterialType(d, 'tv', 'emitter')
    M.addObject(d, 'root', { id: 'box', primitive: 'box', material: 'wall' })
    M.addObject(d, 'root', { id: 'screen', primitive: 'box', material: 'tv' })
    return d
}
{
    const d = doc()
    ok('a picture put into the scene once, under its key', M.addImage(d, a) === a.key && M.addImage(d, a2) === a.key && Object.keys(d.images).length === 1
        && d.images[a.key].name === 'a.png')
    const s = M.addImageSlot(d, 'wall', a.key)
    ok('the first slot: named picture, the material\'s colour, every setting at its default', s.name === 'picture' && s.use === 'colour'
        && s.projection === 'planar' && s.size.x === 100 && s.wrapU === 'repeat' && s.colour === true)
    const s2 = M.addImageSlot(d, 'wall', a.key)
    ok('a second: picture2, and code only (one colour a material)', s2.name === 'picture2' && s2.use === 'none')
    ok('two that are both the colour refused', /one at most/.test(threw(() => M.setImageSlot(d, 'wall', 'picture2', { use: 'colour' })) ?? ''))
    ok('...and nothing changed', M.material(d, 'wall').images[1].use === 'none')
    ok('a slot named as a parameter of the material refused', (() => { M.material(d, 'wall').params.stripe = 1; const e = threw(() => M.setImageSlot(d, 'wall', 'picture2', { name: 'stripe' })); delete M.material(d, 'wall').params.stripe; return /taken/.test(e ?? '') })())
    ok('...or as a name its code has (p, sample)', /taken/.test(threw(() => M.setImageSlot(d, 'wall', 'picture2', { name: 'p' })) ?? '')
        && /taken/.test(threw(() => M.setImageSlot(d, 'wall', 'picture2', { name: 'sample' })) ?? ''))
    ok('a material\'s own parameter may not be called img_...', M.validate({ ...d, materials: d.materials.map(m => m.id === 'wall' ? { ...m, params: { ...m.params, img_x: 1 } } : m) })
        .some(x => /img_/.test(x)))
    ok('bad settings refused, each said', /projection/.test(threw(() => M.setImageSlot(d, 'wall', 'picture', { projection: 'cubic' })) ?? '')
        && /size/.test(threw(() => M.setImageSlot(d, 'wall', 'picture', { size: { x: 0, y: 1 } })) ?? '')
        && /wrapU/.test(threw(() => M.setImageSlot(d, 'wall', 'picture', { wrapU: 'tile' })) ?? ''))
    // what is a compile and what is live
    ok('a placement, a wrap, a filter: the slot\'s uniform (no compile)', M.setImageSlot(d, 'wall', 'picture', { offset: { x: 5, y: 1 }, wrapU: 'mirror', filter: 'pixels', projection: 'box' }).compile === false)
    ok('another picture, a name, its use: a compile', M.setImageSlot(d, 'wall', 'picture', { image: a.key }).compile === false
        && (M.addImage(d, b), M.setImageSlot(d, 'wall', 'picture', { image: b.key }).compile === true)
        && M.setImageSlot(d, 'wall', 'picture2', { name: 'grain' }).compile === true && M.setImageSlot(d, 'wall', 'grain', { use: 'none' }).compile === false
        && M.setImageSlot(d, 'wall', 'picture', { use: 'none' }).compile === true)
    ok('the scene is sound', M.validate(d).length === 0, JSON.stringify(M.validate(d)))
    // a glowing material's first picture: the surface under its glow a screen's dark glass
    M.material(d, 'tv').params.roughness = 0.9
    M.addImageSlot(d, 'tv', a.key)
    const tv = M.material(d, 'tv')
    ok('a glowing material\'s first picture is its glow, the surface under it a screen\'s glass', tv.images[0].use === 'colour'
        && tv.params.roughness === SCREEN_DEFAULTS.roughness && tv.params.baseColor.r === SCREEN_DEFAULTS.baseColor.r)
    ok('...whose fields it then uses (panel, codegen, the registry: materials.js fieldsOf)', M.materialFieldsOf(tv).includes('roughness')
        && !M.materialFieldsOf({ type: 'emitter' }).includes('roughness'))
    // taken away
    M.removeImageSlot(d, 'wall', 'grain'); M.removeImageSlot(d, 'wall', 'picture')
    ok('the last slot taken away: no images list on the material, the pictures kept in the scene', !('images' in M.material(d, 'wall'))
        && Object.keys(d.images).length === 2)
    ok('a slot naming a picture the scene does not have is sound (it reads transparent: images.js)', (() => {
        const d2 = doc(); M.addImageSlot(d2, 'wall', b.key); return M.validate(d2).length === 0 })())
}

// ---- files: only what is used is written; the version; no undo step holds a picture
{
    const d = doc()
    M.addImage(d, a); M.addImage(d, b)
    M.addImageSlot(d, 'wall', a.key)
    const f = JSON.parse(M.serialize(d))
    ok('a file keeps the pictures its materials use, and only those', Object.keys(f.images).length === 1 && f.images[a.key].data === a.entry.data)
    ok('...and the document in memory keeps every one (an undo may want it back)', Object.keys(d.images).length === 2)
    const back = M.parse(M.serialize(d))
    ok('read back: the picture and the slot, at version 29', back.version === 29 && back.images[a.key].width === 64 && back.materials[0].images[0].image === a.key)
    const old = JSON.parse(M.serialize(doc())); old.version = 28
    ok('a file of 28 read as 29, nothing else changed', M.parse(JSON.stringify(old)).version === 29 && !('images' in M.parse(JSON.stringify(old))))
    ok('no picture: no images key in the file', !('images' in JSON.parse(M.serialize(doc()))))
    // the project: the history's text holds no picture, a restore puts the scene's back
    const p = P.createProject([d])
    const key = p.scenes[0].key
    const hist = P.historyText(p)
    ok('the history\'s text holds no picture', !hist.includes(a.entry.data))
    const restored = P.carryOutside(P.parse(hist).project, p)
    ok('a restore from it reads, and carries the scene\'s pictures across', P.scene(restored, key).doc.images[a.key] === d.images[a.key])
    ok('the project file holds the picture used', P.serialize(p).includes(a.entry.data) && !P.serialize(p).includes(b.entry.data))
    ok('...and its scene file', P.serializeScene(p, key).includes(a.entry.data))
}

// ---- an asset carries its pictures into another scene
{
    const d = doc()
    M.addImage(d, a)
    M.addImageSlot(d, 'wall', a.key)
    const matAsset = M.extractAsset(d, 'wall'), nodeAsset = M.extractAsset(d, 'box')
    ok('a material copied out carries its picture', matAsset.images?.[a.key] === d.images[a.key])
    ok('...and an object wearing it', nodeAsset.images?.[a.key] === d.images[a.key])
    const e = M.createDoc({ title: 'elsewhere' })
    M.insertAsset(e, nodeAsset)
    ok('put into another scene: the picture is there, the material shows it', e.images?.[a.key] === d.images[a.key] && e.materials[0].images[0].image === a.key
        && M.validate(e).length === 0, JSON.stringify(M.validate(e)))
    ok('an asset with a bad picture refused', /images/.test(threw(() => M.insertAsset(M.createDoc(), { ...matAsset, images: { [a.key]: { ...a.entry, type: 'x' } } })) ?? ''))
}

// ---- codegen
{
    const plain = doc()
    const before = generate(M.toTree(plain), { id: 'p' })
    M.addImage(plain, a)               // a picture no material uses changes nothing
    const unused = generate(M.toTree(plain), { id: 'p' })
    ok('a scene with a picture no slot names: the text byte for byte, no atlas', before.wgsl === unused.wgsl && !unused.resources?.[IMAGE_RESOURCE])
    M.addImageSlot(plain, 'wall', a.key, { offset: { x: 3, y: 4 } })
    M.addImageSlot(plain, 'tv', a.key)
    M.addImageSlot(plain, 'wall', a.key, { name: 'rough', colour: false })
    M.material(plain, 'wall').code = 'm.roughness = sample(rough).r;'
    for (const data of [false, true]) {
        const g = generate(...M.generateArgs(plain, { id: 'p', data }))
        const how = data ? 'as data' : 'codegen'
        ok(`${how}: the atlas a resource, and init`, g.resources?.[IMAGE_RESOURCE] === 'texture_2d<f32>' && typeof g.init === 'function')
        const u = g.uniforms[uniformName('wall', slotKey('picture'))]
        ok(`${how}: a slot a mat4x4 uniform, its picture's place and its settings`, u?.type === 'mat4x4<f32>'
            && JSON.stringify(u.def) === JSON.stringify(slotMatrix(M.imageSlotOf(M.material(plain, 'wall').images[0]), g.imageRects.get(a.key))))
        ok(`${how}: the surface's colour from it, the glow from the other`, g.wgsl.includes(`m.baseColor = mix(m.baseColor, ic.rgb, ic.a)`)
            && g.wgsl.includes(`m.emissive = mix(m.emissive, ic.rgb * UB.${uniformName('tv', 'emissiveLuminance')}, ic.a)`))
        ok(`${how}: its code given its pictures by name`, g.wgsl.includes(`let rough = UB.${uniformName('wall', slotKey('rough'))};`))
        ok(`${how}: the point in the pattern frame read for it, in mm`, g.wgsl.includes('IMG_Q = p_local * S_local / mm(1.0);') && g.wgsl.includes('localPoint(C.r)'))
        ok(`${how}: the lookup in every copy of the text, the texel read in none (each kernel's own)`, ['wgsl', 'pickWgsl'].every(k => g[k].includes('fn imageAt(') && !g[k].includes('fn imageTexel(')))
    }
}

// ---- through the real builder over a stand-in renderer: a setting live, a new picture a compile
{
    const { installBuilder } = await import('../demo.js')
    const WG = { createTexture: () => ({ tex: true }), device: { queue: { writeTexture() { } } }, createStorageBuffer: n => ({ b: { size: n, destroy() { } }, w() { } }), createBuffer: n => ({ b: { size: n }, w() { } }) }
    const gpu = { makeCompute: (x, m) => ({ wgsl: `${x}\n${m}`, module: { getCompilationInfo: async () => ({ messages: [] }) }, ready: Promise.resolve() }),
                  makeShader: () => ({ getCompilationInfo: async () => ({ messages: [] }) }), device: { limits: { maxStorageBuffersPerShaderStage: 16 } } }
    let state = {}
    const RT = {
        scene: null, compiles: 0,
        set(values) { const unknown = []; for (const [k, v] of Object.entries(values)) { if (k in state) state[k] = structuredClone(v); else unknown.push(k) } return unknown },
        get: () => structuredClone(state), settings: () => ({}), applySettings: () => [], invalidate() { }, updateScene() { return [] },
        async setScene(s) { RT.compiles++; if (s.init) s.buffers = await s.init(WG); RT.scene = s
            state = Object.fromEntries(Object.entries(s.uniforms).map(([k, u]) => [k, structuredClone(u.def)])); return 1 },
    }
    const log = console.log, warn = console.warn
    console.log = () => { }; console.warn = () => { }
    let got
    try {
        const d = doc()
        M.addImage(d, a)
        M.addImageSlot(d, 'wall', a.key)
        const B = installBuilder({}, { RT, gpu, project: P.createProject([d]) })
        await B.apply()
        const n0 = RT.compiles
        const name = uniformName('wall', slotKey('picture'))
        const m = M.material(B.doc, 'wall')
        const bound = RT.scene?.buffers?.[IMAGE_RESOURCE]
        m.images[0].size.x = 37; m.images[0].turn = 45
        const took = B.live('wall', slotKey('picture'))
        const want = slotMatrix(M.imageSlotOf(m.images[0]), RT.scene.imageRects.get(a.key))
        const live = { took, value: JSON.stringify(RT.get()[name]) === JSON.stringify(want), compiles: RT.compiles - n0 }
        // another picture: not in the atlas compiled -- not live
        M.addImage(B.doc, b)
        M.setImageSlot(B.doc, 'wall', 'picture', { image: b.key })
        const notLive = B.live('wall', slotKey('picture'))
        await B.apply()
        got = { bound: !!bound, live, notLive, after: RT.scene.imageRects.has(b.key), compiled: RT.compiles - n0 }
    } finally { console.log = log; console.warn = warn }
    ok('the builder\'s scene shown: the atlas made by its init and bound', got.bound)
    ok('a slot\'s size and turn moved: its uniform written live, no compile', got.live.took && got.live.value && got.live.compiles === 0, JSON.stringify(got.live))
    ok('another picture chosen: not live (the atlas compiled has none of it), and the compile has it', got.notLive === false && got.after && got.compiled === 1, JSON.stringify(got))
}

// ---- which pictures a scene uses
{
    const d = doc()
    M.addImage(d, a); M.addImage(d, b)
    M.addImageSlot(d, 'tv', b.key); M.addImageSlot(d, 'wall', a.key); M.addImageSlot(d, 'wall', b.key)
    ok('the pictures used, each once, in the order first used', JSON.stringify(usedImages(d)) === JSON.stringify([a.key, b.key]))
    ok('toTree hands codegen those, the document\'s own entries (not copies)', M.toTree(d).images[a.key] === d.images[a.key])
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
