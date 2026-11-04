// node tools/test/script.test.mjs
//
// THE SCENE'S SCRIPT (0.82.0; builder/model.js SCRIPT, tools/scriptapi.js), without a browser: the script kept in the
// scene and out of the undo history; the API it is handed driven against stand-ins for the registry, the renderer, the
// builder and the Analysis pane -- a setting read and written (quietly, a typo thrown), several checked before any is
// set, the camera, settled() waiting out a compile, a render kept and saved with the look asked for, a stale one
// refused; Stop ending a script at its next await and a `finally` still putting things back; an error's line the
// script's own. The numbers an analysis gives against closed forms, through the same functions the charts draw from: a
// uniform far field's peak and its flux within a cone, a floor lit evenly read as 1 lx everywhere, its encircled flux.
// And every example compiles; two run here. Whether the panel looks right, and what a script does to a real picture,
// is the user's.
import * as M from '../../builder/model.js'
import * as P from '../../builder/project.js'
import { makeParams } from '../../lib/shell/params.js'
import { farGeometry } from '../../lib/pathtracer/optics/farfield.js'
import { makeScriptApi, runScript, scriptLocation, analysisOf, toCSV, formatValue, fileBlob, STOPPED, SCRIPT_NAMES } from '../scriptapi.js'
import { highlightJS } from '../scripthighlight.js'
import { SCRIPT_REF, documentedNames, referenceMarkdown } from '../scriptref.js'
import { PARAM_MIME, nameFor, declaredNames, offsetAt, dropEdit } from '../scriptdrop.js'
import { PARAM_DRAG } from '../../lib/shell/paramspanel.js'
import { SCRIPT_EXAMPLES } from '../scriptexamples.js'
import { chunk } from '../../lib/pathtracer/darkroom/export/png.js'

let pass = 0, fail = 0
const eq = (name, got, want) => {
    const a = JSON.stringify(got), b = JSON.stringify(want)
    if (a === b) pass++
    else { fail++; console.log(`FAIL  ${name}\n      got  ${a}\n      want ${b}`) }
}
const near = (name, got, want, tol = 1e-9) => {
    if (Number.isFinite(got) && Math.abs(got - want) <= tol * Math.max(1, Math.abs(want))) pass++
    else { fail++; console.log(`FAIL  ${name}\n      got  ${got}\n      want ${want} (within ${tol})`) }
}
const throws = async (name, fn, like) => {
    try { await fn(); fail++; console.log(`FAIL  ${name}: did not throw`) }
    catch (e) { if (!like || like.test(String(e?.message ?? e)) || like.test(e?.name ?? '')) pass++; else { fail++; console.log(`FAIL  ${name}: threw ${e?.name}: ${e?.message}`) } }
}

// ---- THE SCRIPT IN THE SCENE ------------------------------------------------------------------------------------------
{
    const d = M.createDoc({ title: 'S' })
    eq('a new scene has no script', [M.sceneScriptOf(d), 'script' in d], ['', false])
    M.setScript(d, 'log(1)')
    eq('set, it is the scene\'s', M.sceneScriptOf(d), 'log(1)')
    eq('...valid, and read back from the file as it was', [M.validate(d).length, M.sceneScriptOf(M.parse(M.serialize(d)))], [0, 'log(1)'])
    M.setScript(d, '')
    eq('\'\' takes it away', 'script' in d, false)
    await throws('one too long is refused', () => M.setScript(d, 'x'.repeat(M.SCRIPT_MAX + 1)), /more than/)
    eq('...and changes nothing', 'script' in d, false)
    const bad = M.createDoc({ title: 'B' }); bad.script = 42
    eq('a file whose script is not text is refused by name', M.validate(bad).some(p => /script must be text/.test(p)), true)

    // no undo step: out of the history's text, carried across a restore (project.js OUTSIDE_HISTORY)
    const a = M.createDoc({ title: 'A' }); M.setScript(a, 'log("kept")')
    const pr = P.createProject([a])
    eq('the script is outside the history', P.OUTSIDE_HISTORY.includes('script'), true)
    eq('...its text left out of a snapshot', JSON.parse(P.historyText(pr)).scenes[0].doc.script, undefined)
    const back = P.carryOutside(P.parse(P.historyText(pr)).project, pr)
    eq('...and given back across a restore', M.sceneScriptOf(back.scenes[0].doc), 'log("kept")')
}

// ---- STAND-INS -----------------------------------------------------------------------------------------------------
const frames = { n: 0 }
const frame = () => { frames.n++; return Promise.resolve() }
const S = { radius: 1, pos: [0, 0, 0], depth: 3 }
const writes = []
const PARAMS = makeParams()
PARAMS.provide('scene', () => [
    { path: 'scene/n4/radius', label: 'lens › radius', min: 0.5, max: 5, animated: true, unit: 'mm', get: () => S.radius, set: (v, o) => { S.radius = v; writes.push(['radius', v, o?.quiet]) } },
    { path: 'scene/n4/transform/position', label: 'lens › position', dims: 3, get: () => S.pos, set: v => { S.pos = v } },
    { path: 'scene/n5/depth', label: 'sponge › depth', kind: 'structural', min: 1, max: 6, step: 1, get: () => S.depth, set: v => { S.depth = v; BUILDER.busyFor = 5 } },
])
const BUILDER = {
    busyFor: 0,
    get applying() { return this.busyFor > 0 && this.busyFor-- > 0 },
    doc: { title: 'Bench', unit: 'mm', root: { id: 'root', children: [{ id: 'n4', label: 'lens', kind: 'object', children: [] },
                                                                     { id: 'g1', label: 'mount', kind: 'group', children: [{ id: 'n5', label: 'sponge', kind: 'object' }] }] } },
}
const cam = { mode: 'orbit', azimuth: 10, elevation: 60, distance: 400, target: [0, 0, 0] }
const saved = [], shown = [], jobs = []
let kept = null
const RT = {
    hud: { samples: 0 },
    running: () => true,
    view: () => ({ camera: structuredClone(cam), exposure: { exposureEV: 12 } }),
    applyView: ({ camera }) => { if (camera) Object.assign(cam, camera) },
    size: () => ({ w: 320, h: 200 }),
    offscreenBusy: () => false,
    sceneBusy: () => false,
    kernelsSettled: () => Promise.resolve(),
    measure: async (x, y) => ({ L: 100 * (x + 2), se: 1 }),
    renderPicture: async ({ width, height, samples, signal, onProgress }) => {
        for (let i = 1; i <= samples; i++) { signal?.throwIfAborted(); onProgress?.(i, samples) }
        kept = { w: width, h: height, samples, view: { ev: 13, toneMap: 1, contrast: 0 } }
        return { ...kept, view: { ...kept.view } }
    },
    darkroomShow: pic => { shown.push(pic.w); return true },
    darkroomLook: () => ({ ev: 9, toneMap: 2, contrast: 0.3 }),
    darkroom: {
        get picture() { return kept && { ...kept } },
        // a PNG's signature, its header and its end: the export puts its text in after the header (png.js insertText)
        developed: async (s, { type }) => { RT.developedWith = s
            return new Blob(type === 'image/png' ? [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', new Uint8Array(13)), chunk('IEND', new Uint8Array(0))] : ['picture'], { type }) },
        pixel: async (x, y) => ({ rgb: [x, y, 0], Y: 1 }),
        meter: async () => 11,
    },
}
const out = []
const api = (signal = new AbortController().signal) => makeScriptApi({ PARAMS, RT, BUILDER, signal, frame,
    log: (t, k) => out.push([k, t]), save: (b, name) => saved.push([name, b.size, b.type]), progress: j => jobs.push(j) })

// ---- SETTINGS ----------------------------------------------------------------------------------------------------
{
    const A = api()
    eq('the settings under a path', A.params.list('scene/n4').map(p => p.path), ['scene/n4/radius', 'scene/n4/transform/position'])
    eq('...an entry as a script reads it', (({ path, value, min, max, unit, kind, animated, dims }) => ({ path, value, min, max, unit, kind, animated, dims }))(A.params.info('scene/n4/radius')),
        { path: 'scene/n4/radius', value: 1, min: 0.5, max: 5, unit: 'mm', kind: 'live', animated: true, dims: 1 })
    eq('the animated alone', A.params.animated().map(p => p.path), ['scene/n4/radius'])
    eq('the live alone', A.params.list('', { live: true }).map(p => p.path).includes('scene/n5/depth'), false)
    eq('set: coerced to its range, and returned so', A.params.set('scene/n4/radius', 9), 5)
    eq('...quietly: no undo step', writes.at(-1), ['radius', 5, true])
    A.params.set('scene/n4/radius', 2, { undo: true })
    eq('...one when asked', writes.at(-1), ['radius', 2, false])
    eq('a vector read as its numbers', A.params.get('scene/n4/transform/position'), [0, 0, 0])
    await throws('a path that does not exist throws, saying what is near', () => A.params.set('scene/n4/radiuss', 1), /no parameter 'scene\/n4\/radiuss'.*did you mean/)
    const before = S.radius
    await throws('apply checks every path before any is set', () => A.params.apply({ 'scene/n4/radius': 3, 'scene/nope/x': 1 }), /no parameter/)
    eq('...so nothing was', S.radius, before)
    eq('apply sets them all', A.params.apply({ 'scene/n4/radius': 3, 'scene/n4/transform/position': [1, 2, 3] }), { 'scene/n4/radius': 3, 'scene/n4/transform/position': [1, 2, 3] })
    eq('the scene\'s nodes, by label and id, with their paths', A.scene.nodes().map(n => [n.label, n.id, n.parent, n.path]),
        [['lens', 'n4', 'root', 'scene/n4'], ['mount', 'g1', 'root', 'scene/g1'], ['sponge', 'n5', 'g1', 'scene/n5']])
    eq('...one found by its label', A.scene.node('sponge')?.id, 'n5')
    eq('the scene\'s unit and title', [A.scene.unit, A.scene.title], ['mm', 'Bench'])

    // a structural write compiles: settled waits it out
    frames.n = 0
    A.params.set('scene/n5/depth', 4)
    await A.settled()
    eq('settled waits while the builder applies, then a few quiet frames', frames.n >= 5 + 3, true)

    eq('the camera, set in part', (A.camera.set({ azimuth: 45 }), [cam.azimuth, cam.elevation]), [45, 60])
    eq('...read back', A.camera.get().azimuth, 45)
    eq('the picture measured at a point', (await A.picture.measure(0, 0)).L, 200)
    RT.hud.samples = 0
    let ticks = 0
    const grow = frame
    const A2 = makeScriptApi({ PARAMS, RT, BUILDER, frame: () => { if (++ticks > 2) RT.hud.samples += 4; return grow() } })
    eq('picture.wait: until the live picture holds that many samples', await A2.picture.wait(16), 16)
}

// ---- A RENDER KEPT, SHOWN AND SAVED ---------------------------------------------------------------------------------
{
    const A = api()
    const pic = await A.render({ width: 64, height: 48, samples: 8 })
    eq('rendered at the size asked, and shown in the darkroom', [pic.width, pic.height, pic.samples, shown.at(-1)], [64, 48, 8, 64])
    eq('...its progress in the status bar, then cleared', [jobs.some(j => j?.done === 8), jobs.at(-1)], [true, null])
    const r = await pic.save('frame-001.jpg')
    eq('saved under the name given, its format by the extension', [saved.at(-1)[0], saved.at(-1)[2], r.name], ['frame-001.jpg', 'image/jpeg', 'frame-001.jpg'])
    eq('...developed as the view showed it', RT.developedWith.ev, 13)
    await pic.blob('x.webp', { look: 'darkroom' })
    eq('look \'darkroom\': the panel\'s settings', [RT.developedWith.ev, RT.developedWith.toneMap], [9, 2])
    await pic.blob('x.webp', { look: { from: 'darkroom', ev: 15 } })
    eq('...with a setting over them', [RT.developedWith.ev, RT.developedWith.contrast], [15, 0.3])
    await pic.blob('x.webp', { look: { toneMap: 0 } })
    eq('...or over the view\'s', [RT.developedWith.ev, RT.developedWith.toneMap], [13, 0])
    await throws('a format the darkroom has not is refused by name', () => pic.save('x.tiff'), /format 'tiff' is not one of/)
    eq('a pixel of it', (await pic.pixel(3, 4)).rgb, [3, 4, 0])
    const next = await A.render({ samples: 2 })
    eq('without a size, the live view\'s', [next.width, next.height], [320, 200])
    await throws('the darkroom keeps one picture: the first is no longer it', () => pic.save('old.jpg'), /no longer the darkroom's/)
    const ctrl = new AbortController()
    const B = api(ctrl.signal)
    ctrl.abort()
    await throws('a render with Stop pressed ends as stopped', () => B.render({ samples: 4 }), new RegExp(STOPPED))
}

// ---- RUNNING ONE -----------------------------------------------------------------------------------------------------
{
    out.length = 0
    eq('a script\'s names are the API\'s, its value returned', await runScript('log("r =", params.get("scene/n4/radius")); return 1 + 1', api()), 2)
    eq('...log prints numbers and objects as a line', out.at(-1), ['log', 'r = 3'])
    eq('st is the whole of it', await runScript('return typeof st.optics.run', api()), 'function')
    await throws('a syntax error throws before anything runs', () => runScript('log(1)\nlet = = 2', api()), /SyntaxError|Unexpected/)
    try { await runScript('const a = 1\n\nnull.x', api()); fail++ }
    catch (e) {
        const at = scriptLocation(e)
        // V8 says where in a Function body it threw; an engine that does not leaves the line out (null), never a wrong one
        if (at === null || at.line === 3) pass++; else { fail++; console.log(`FAIL  the line an error is on: ${JSON.stringify(at)}`) }
        eq('...this one, in Node, says it', at?.line, 3)
    }
    eq('strict mode: an undeclared name is an error, not a global', await runScript('try { undeclared = 1; return "set" } catch (e) { return e.name }', api()), 'ReferenceError')

    // STOP: at the next await, and a finally still runs
    const ctrl = new AbortController()
    cam.azimuth = 10
    const run = runScript('try { for (;;) { camera.set({ azimuth: 99 }); await sleep(5) } } finally { camera.set({ azimuth: 10 }); log("put back") }', api(ctrl.signal))
    setTimeout(() => ctrl.abort(), 30)
    await throws('Stop ends a loop at its next await', () => run, new RegExp(STOPPED))
    eq('...and its finally puts things back', [cam.azimuth, out.at(-1)], [10, ['log', 'put back']])
}

// ---- WHAT AN ANALYSIS GIVES, against closed forms ---------------------------------------------------------------------
{
    // A UNIFORM FAR FIELD: I0 cd in every direction of the lower half (gamma 0..90), none above -- each bin's flux I0
    // times its solid angle. Its peak is I0; the flux within a cone of half angle a is I0 2 pi (1 - cos a).
    const nC = 72, nG = 181, I0 = 50
    const { omega } = farGeometry(nC, nG)
    const flux = new Float64Array(nC * nG)
    for (let j = 0; j < nG; j++) for (let i = 0; i < nC; i++) flux[j * nC + i] = j * 1 <= 90 ? (j * 1 === 90 ? 0.5 : 1) * I0 * omega[j] : 0
    const total = flux.reduce((a, b) => a + b, 0)
    const far = { mode: 'escaped', material: 0, nC, nG, axis: [0, 0, 1], c0: [1, 0, 0], flux, se: null, batches: 4, rays: 4e6, emitted: total, unit: 'lm' }

    // A FLOOR LIT EVENLY: a 64 x 64 grid of hits over 1 m x 1 m at z = 0, 1 lm in all -- 1 lx everywhere. Mapped over
    // its box in 16 x 16 cells, each cell holds 16 hits: exactly 1 lx, uniformity 1.
    const hits = []
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) hits.push({ pos: [(x + 0.5) / 64, (y + 0.5) / 64, 0], dir: [0, 0, -1], flux: 1 / 4096, tag: 3 })
    hits.push({ pos: [5, 5, 5], dir: [0, 0, 1], flux: 1, tag: 7 })
    const box = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 0.001], [1, 0, 0.001], [0, 1, 0.001], [1, 1, 0.001]]
    const v = (x, se = null) => ({ value: x, se })
    const snapshot = {
        results: { unit: 'lm', rays: 4e6, batches: 4, emitted: v(total), escaped: v(total * 0.8, 0.01), lost: v(0), absorbed: v(total * 0.2), detected: v(1), volume: v(0),
                   objects: [{ index: 3, name: 'n9', incident: v(1), absorbed: v(1), hits: 4096 }], materials: [] },
        far, rays: 4e6, at: new Date(0), stale: false, hits, hitsUnit: 'lm', lengthUnit: 'm', metresPerUnit: 1,
        tagName: t => ({ 3: 'floor', 7: 'speck' })[t] ?? `tag ${t}`, matName: i => `material ${i}`,
        corners: t => t === 3 ? box : null,
    }
    const a = analysisOf(snapshot)
    near('the peak of a uniform field is its intensity', a.peak().I, I0, 1e-9)
    near('the flux within 30 degrees: I0 2 pi (1 - cos 30)', a.fluxWithin(30), I0 * 2 * Math.PI * (1 - Math.cos(Math.PI / 6)), 1e-9)
    near('...within 60, and between 30 and 60 the difference', a.fluxBetween(30, 60), I0 * 2 * Math.PI * (Math.cos(Math.PI / 6) - Math.cos(Math.PI / 3)), 1e-9)
    near('the far field holds the hemisphere: 2 pi I0', a.farFlux, 2 * Math.PI * I0, 1e-9)
    near('I at any direction below the horizon', a.intensityAt(45, 123).I, I0, 1e-9)
    eq('the efficiency the escaped share', a.efficiency, 0.8)
    eq('an object named as the tree names it', [a.objects[0].name, a.object('floor')?.tag], ['floor', 3])
    eq('the detectors hit, by name, with their hits', a.detectors(), [{ tag: 3, name: 'floor', hits: 4096 }, { tag: 7, name: 'speck', hits: 1 }])
    const m = a.map('floor', { cells: 16 })
    near('an evenly lit floor: E max 1 lx', m.max, 1, 1e-9)
    near('...its mean 1 lx', m.meanLit, 1, 1e-9)
    near('...its uniformity 1', m.uniformity, 1, 1e-9)
    near('...the flux it holds, 1 lm', m.encircled().total, 1, 1e-9)
    eq('...in the world\'s x and y, read at a point', [m.axisNames, Math.abs(m.at(0.5, 0.5).E - 1) < 1e-9], [['x', 'y'], true])
    eq('...a profile across it, a cell each', m.profile('a', 'centroid').length, 16)
    eq('a map by its tag too', a.map(3, { cells: 16 }).nx, 16)
    await throws('a detector not hit is said, with the ones that were', () => a.map('wall'), /no detector 'wall' was hit \(hit: floor, speck\)/)
    await throws('one with too few hits is said', () => a.map('speck'), /too few hits/)
    const plane = a.plane({ h: 1, half: 0.5, cells: 16 })
    // a point source of I0 over a plane 1 m off: E = I0 cos^3(gamma) / h^2, I0 under it
    near('the far field on a plane 1 m off: I0 lx under the source', plane.at(0.01, 0.01).E, I0 * Math.cos(Math.atan(Math.hypot(1 / 32, 1 / 32))) ** 3, 1e-6)
    eq('no far field, no intensity: said', await (async () => { try { analysisOf({ ...snapshot, far: null }).peak(); return 'none' } catch (e) { return /no far field/.test(e.message) } })(), true)

    // through the API: the pane's analysis run with its setup, and read
    const asked = []
    const OPTICS = { analyse: async s => { asked.push(s); return snapshot }, analysis: () => snapshot, analysisSetup: () => ({ rays: 1e6 }), setupAnalysis: p => p }
    const A = makeScriptApi({ PARAMS, RT, BUILDER, OPTICS, frame })
    const r = await A.optics.run({ rays: 2e5, from: 'escaped' })
    eq('optics.run hands the pane its setup and reads what it found', [asked.at(-1), Math.round(r.peak().I)], [{ rays: 2e5, from: 'escaped' }, I0])
    eq('optics.last is the pane\'s last', A.optics.last().rays, 4e6)
    await throws('a page with no Analysis pane says so', () => makeScriptApi({ PARAMS, RT }).optics.run(), /no Analysis pane/)
}

// ---- FILES AND THE OUTPUT -----------------------------------------------------------------------------------------------
{
    eq('rows as CSV, quoted where they must be', toCSV([['a', 'b'], [1, 'x,y'], [2, 'say "hi"']]), 'a,b\n1,"x,y"\n2,"say ""hi"""\n')
    eq('objects as CSV, the first one\'s keys the header', toCSV([{ x: 1, y: 2 }, { x: 3, y: 4 }]), 'x,y\n1,2\n3,4\n')
    eq('a file\'s type by its contents and name', [fileBlob('a.csv', [[1]]).type, fileBlob('a.json', { a: 1 }).type, fileBlob('a.txt', 'hi').type, fileBlob('a.json', [1, 2]).type],
        ['text/csv', 'application/json', 'text/plain', 'application/json'])
    eq('JSON with a typed array as a list', JSON.parse(await fileBlob('a.json', { v: new Float32Array([1, 2]) }).text()), { v: [1, 2] })
    eq('a value as a line', formatValue({ a: 1 / 3, b: [1, 2], c: 'x', d: new Float64Array(30) }).startsWith('{ a: 0.333333, b: [1, 2], c: "x", d: [0, 0,'), true)
}

// ---- THE EXAMPLES ---------------------------------------------------------------------------------------------------------
{
    const names = Object.keys(api())
    const AsyncFunction = (async () => { }).constructor
    for (const x of SCRIPT_EXAMPLES) {
        try { new AsyncFunction(...names, x.code); pass++ } catch (e) { fail++; console.log(`FAIL  example '${x.id}' does not compile: ${e.message}`) }
    }
    out.length = 0
    await runScript(SCRIPT_EXAMPLES.find(x => x.id === 'settings').code, api())
    eq('the settings example lists the animated, the camera and the nodes', [out[0][1], out.some(l => /^camera:/.test(l[1])), out.some(l => /^nodes: lens \(n4\)/.test(l[1]))], ['1 animated:', true, true])
    saved.length = 0
    S.radius = 2
    await runScript(SCRIPT_EXAMPLES.find(x => x.id === 'generative').code, api())
    eq('the generative example renders its series and saves each', saved.map(s => s[0]), ['series-001.png', 'series-002.png', 'series-003.png', 'series-004.png'].map(n => n))
    eq('...and puts the settings back as they were', S.radius, 2)
}

// ---- A SETTING AS A VARIABLE: param(path) -----------------------------------------------------------------------------
{
    const A = api()
    S.pos = [0, 0, 0]; S.radius = 1
    const pos = A.param('scene/n4/transform/position')
    pos.value = [1, 2, 4]
    eq('the whole of it written through .value', S.pos, [1, 2, 4])
    eq('...a part read by its index and by its name', [pos[0], pos.y, pos.z, pos.length], [1, 2, 4, 3])
    pos.z = 9
    eq('a part written alone, the rest kept', S.pos, [1, 2, 9])
    pos[0] += 1
    eq('...and added to', S.pos, [2, 2, 9])
    eq('it destructures', (() => { const [a, b, c] = pos; return [a, b, c] })(), [2, 2, 9])
    eq('it is live: a change from elsewhere read at once', (S.pos = [5, 5, 5], pos.x), 5)
    let threw = null
    try { pos.value[0] = 7 } catch (e) { threw = e.name }
    eq('.value of a vector is a frozen copy: writing into it throws, never writes nothing', [threw, S.pos[0]], ['TypeError', 5])
    await throws('a part it has not is refused, saying what it has', () => { pos.q = 1 }, /'q' is not a part of it -- write \.value, \[0\] to \[2\] or x y z/)
    const r = A.param('scene/n4/radius')
    eq('a number in arithmetic as itself', [r * 2, `${r} mm`, r > 0.5], [2, '1 mm', true])
    r.value *= 3
    eq('...and set, coerced to its range', [S.radius, (r.value = 99, S.radius)], [3, 5])
    eq('a handle given as a value is read', (A.param('scene/n4/radius').value = r, S.radius), 5)
    eq('log prints its value', formatValue(pos), '[5, 5, 5]')
    eq('...JSON too', JSON.stringify({ pos }), '{"pos":[5,5,5]}')
    eq('.set with an undo step, .info its entry', (r.set(2, { undo: true }), [writes.at(-1), r.info.max]), [['radius', 2, false], 5])
    await throws('a path that does not exist throws at the binding', () => A.param('scene/n4/radiu'), /no parameter 'scene\/n4\/radiu'/)
    eq('in a script, as the user wrote it nearly', await runScript(`const spherepos = param('scene/n4/transform/position')
spherepos.value = [1, 2, 4]
let x = spherepos[0]
return [x, spherepos.z]`, api()), [1, 4])
    await throws('...and spherepos = [1, 2, 4] on a const is an error, not nothing', () => runScript(`const spherepos = param('scene/n4/transform/position')
spherepos = [1, 2, 4]`, api()), /constant/)
}

// ---- A SETTING DROPPED INTO THE EDITOR (tools/scriptdrop.js) -----------------------------------------------------------
{
    eq('the panel\'s drag type is the editor\'s', PARAM_DRAG, PARAM_MIME)
    eq('a name from a label, camelCase', [nameFor('lens › radius'), nameFor('Sphere 2 › position'), nameFor('Één › kleur'), nameFor('3 › x')],
        ['lensRadius', 'sphere2Position', 'eenKleur', 'p3X'])
    eq('...never a keyword or the API\'s, never one taken', [nameFor('camera'), nameFor('new'), nameFor('lens › radius', new Set(['lensRadius', 'lensRadius2']))],
        ['cameraParam', 'newParam', 'lensRadius3'])
    eq('the names a script declares', [...declaredNames('const a = 1\nlet [b, c] = x\nvar { d, e: f } = y\nfunction g() {}')].sort(), ['a', 'b', 'c', 'd', 'f', 'g'])
    eq('a point on screen to a place: a tab to its stop, past the end, below', [offsetAt('ab\n\tc', 1, 4.2), offsetAt('ab\ncd', 0, 9), offsetAt('ab', 5, 0)],
        [{ offset: 4, past: false, below: false }, { offset: 2, past: true, below: false }, { offset: 2, past: true, below: true }])
    const item = { path: 'scene/n4/radius', label: 'lens › radius', kind: 'live' }
    const apply = (code, d) => code.slice(0, d.from) + d.text + code.slice(d.to)
    const c1 = 'log(1)\n    \nlog(2)'
    eq('on an empty line: the binding, at its indent', apply(c1, dropEdit(c1, offsetAt(c1, 1, 0), item)), "log(1)\n    const lensRadius = param('scene/n4/radius')   // lens › radius\nlog(2)")
    const c2 = 'const r = '
    eq('after a line that goes on: the call alone', apply(c2, dropEdit(c2, offsetAt(c2, 0, 20), item)), "const r = param('scene/n4/radius')")
    const c3 = 'log(1)'
    eq('right of a finished line: the binding on a line of its own', apply(c3, dropEdit(c3, offsetAt(c3, 0, 20), item)), "log(1)\nconst lensRadius = param('scene/n4/radius')   // lens › radius")
    eq('...under the last line: the same', apply(c3, dropEdit(c3, offsetAt(c3, 4, 0), item)), "log(1)\nconst lensRadius = param('scene/n4/radius')   // lens › radius")
    const c4 = 'log(, 2)'
    eq('inside code: the call alone, where it landed', apply(c4, dropEdit(c4, offsetAt(c4, 0, 4), item)), "log(param('scene/n4/radius'), 2)")
    const c5 = "const lensRadius = 1\n"
    eq('a name already declared: another', apply(c5, dropEdit(c5, offsetAt(c5, 1, 0), { ...item, kind: 'structural' })),
        "const lensRadius = 1\nconst lensRadius2 = param('scene/n4/radius')   // lens › radius, compiles")
    const c6 = 'for (;;) {'
    eq('after an opening brace, one indent more', apply(c6, dropEdit(c6, offsetAt(c6, 0, 30), item)).split('\n')[1].startsWith("    const lensRadius"), true)
    const dropped = apply(c1, dropEdit(c1, offsetAt(c1, 1, 0), item))
    eq('what is dropped runs', await runScript(dropped.replace(/log\(\d\)/g, '') + '\nreturn lensRadius.value', api()), 2)
}

// ---- THE EDITOR'S COLOURS (tools/scripthighlight.js) ------------------------------------------------------------------------
{
    const unhtml = h => h.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    const kinds = (code, opts) => [...highlightJS(code, opts).matchAll(/<span class="hl-(\w+)">([^<]*)<\/span>/g)].map(m => [m[1], unhtml(m[2])])
    // the text is never changed, only wrapped: the colours would drift off the caret
    const tricky = 'const a = `x ${b + `y ${c}`} z` // done\nlet r = /a\\/[/]b/g, d = e / f / 2, s = "q // not a comment", t = \'it\\\'s\'\n/* a <b> & c */ x &&= 0x1F + .5e3 + 10n'
    eq('the text is the code exactly, in every example and a tricky line', [...SCRIPT_EXAMPLES.map(x => x.code), tricky, '`open', '"open', '/* open', 'a /'].every(c => unhtml(highlightJS(c)) === c), true)
    const k = kinds('// note\nconst x = "a // b"; log(x)', { globals: SCRIPT_NAMES })
    eq('a comment, a keyword, a string with // in it, the API\'s name', k, [['com', '// note'], ['kw', 'const'], ['str', '"a // b"'], ['api', 'log']])
    eq('a template\'s ${...} is code, to any depth', kinds('`a ${params.get(`p${n}`)} b`', { globals: SCRIPT_NAMES }).map(x => x[0]),
        ['str', 'tpl', 'api', 'fn', 'str', 'tpl', 'tpl', 'str', 'tpl', 'str'])
    eq('a division is no regular expression; after = or ( one is', [kinds('a / b / 2').map(x => x[0]), kinds('x = /a+b/g').map(x => x[0]), kinds('f(/[/]/)').map(x => x[0])],
        [['num'], ['re'], ['fn', 're']])
    eq('after return, a / opens one', kinds('return /x/').map(x => x[0]), ['kw', 're'])
    eq('numbers of every kind', kinds('1 2.5 .5 1e-3 0xFF 10n').map(x => x[1]), ['1', '2.5', '.5', '1e-3', '0xFF', '10n'])
    eq('a method called and a property read, after a dot', kinds('a.peak().I').map(x => x), [['fn', 'peak'], ['prop', 'I']])
    eq('HTML in the code is escaped', highlightJS('a<b&&c>d'), 'a&lt;b&amp;&amp;c&gt;d')
    eq('the names coloured are the ones a script is handed', [...SCRIPT_NAMES].sort(), Object.keys(api()).sort())
}

// ---- THE REFERENCE (tools/scriptref.js): every name the API has, and nothing it has not ------------------------------
{
    // what a script can reach, walked: the API's names and its objects' members, a render's handle, an analysis, a map,
    // a setting's handle -- each as the reference spells it (pic., a., m., p.)
    const A = api()
    const have = new Set()
    for (const [k, v] of Object.entries(A)) {
        if (k === 'st') { have.add('st'); continue }
        if (v && typeof v === 'object' && !(v instanceof AbortSignal)) for (const m of Object.keys(v)) have.add(`${k}.${m}`)
        else have.add(k)
    }
    const pic = await A.render({ width: 8, height: 8, samples: 1 })
    for (const m of Object.keys(pic)) have.add(`pic.${m}`)
    // the far field and the hits of the closed-form test above, made again here (a map needs hits, a.plane a far field)
    const nC = 8, nG = 19, omega = farGeometry(nC, nG).omega
    const flux = new Float64Array(nC * nG).map((_, k) => omega[Math.floor(k / nC)])
    const hits = Array.from({ length: 64 }, (_, i) => ({ pos: [(i % 8) / 8, Math.floor(i / 8) / 8, 0], dir: [0, 0, -1], flux: 1 / 64, tag: 3 }))
    const v = x => ({ value: x, se: null })
    const a = analysisOf({ results: { unit: 'lm', rays: 1, batches: 1, emitted: v(1), escaped: v(1), lost: v(0), absorbed: v(0), detected: v(0), volume: v(0), objects: [], materials: [] },
                          far: { nC, nG, flux, se: null, emitted: 1, unit: 'lm', axis: [0, 0, 1], c0: [1, 0, 0] }, hits, metresPerUnit: 1, tagName: () => 'floor' })
    for (const m of Object.getOwnPropertyNames(a)) have.add(`a.${m}`)
    for (const m of Object.keys(a.map('floor', { cells: 4, area: 'lit' }))) have.add(`m.${m}`)
    for (const m of ['value', 'info', 'path', 'get', 'set', 'length']) have.add(`p.${m}`)
    const p = A.param('scene/n4/transform/position')
    eq('every member a setting\'s handle names is one the walk knows', ['value', 'info', 'path', 'get', 'set'].every(k => k in p), true)
    const doc = documentedNames()
    // the parts of a handle are written p[i], p.x ... in the reference: not members to walk
    const parts = ['p[i]', 'p.x', 'p.y', 'p.z', 'p.w', 'p.r', 'p.g', 'p.b', 'p.a']
    eq('every name a script can reach has words in the reference', [...have].filter(n => !doc.has(n)).sort(), [])
    eq('...and every name the reference has words for is one it can reach', [...doc].filter(n => !have.has(n) && !parts.includes(n)).sort(), [])
    const AsyncFunction = (async () => { }).constructor
    const bad = SCRIPT_REF.flatMap(s => s.items).filter(i => i.example).filter(i => { try { new AsyncFunction(...Object.keys(A), i.example); return false } catch { return true } })
    eq('every example in it compiles', bad.map(i => i.sig), [])
    eq('...written as a help page with a heading a section and one a name', [referenceMarkdown().split('\n## ').length - 1, referenceMarkdown().split('\n### ').length - 1],
        [SCRIPT_REF.length, SCRIPT_REF.reduce((n, s) => n + s.items.length, 0)])
}

console.log(`script (the scene's script and its API): ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
