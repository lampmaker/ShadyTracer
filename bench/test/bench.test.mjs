//======================================================================================================================
// Tests for the benchmark's definition (bench). Run: node bench/test/bench.test.mjs
//
// What it CANNOT check is the timing: that exists only on a real GPU, run by a person. What it can check is that
// every row is what its label says -- because a benchmark row that quietly measures something else is worse than
// no row -- that the camera sees what it should, and that the scenes in different units are the same scene:
//   - the frozen copies parse and generate, and every variant's SDF is what its label promises;
//   - each row's settings name uniforms that exist (a typo would be a row identical to the base);
//   - the unit rows: byte-identical scene WGSL, every uniform either the same or a length scaled by exactly
//     the factor, and the same physical extent and surface tolerance;
//   - THE FRAMING, through lib/camera.js itself: the first version's camera stood above the studio scenes'
//     softbox and looked down through it (the user saw it; `elevation` is degrees off vertical);
//   - the runner's bench path, against a renderer that records instead of rendering.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { benchTest, BENCH, CAMERAS, sceneOf } from '../index.js'
import { rescaled, converted, withoutMaterialCode, withoutGroupCode, withReliefCode, codedGroups, lengthScale } from '../variants.js'
import { MODIFIERS, RELIEF_CODE_FBM_BOUND } from '../../builder/modifiers.js'
import { UniformSpec } from '../../lib/pathtracer/core/uniforms.schema.js'
import { autoEps, unitScale } from '../../lib/pathtracer/core/photometry.js'
import { toParent } from '../../builder/bounds.js'
import * as Model from '../../builder/model.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b))

const load = u => readFileSync(u, 'utf8')
const T = await benchTest(load)
const row = l => T.cases.find(c => c.label === l)
const base = T.cases[0]
const docOf = f => Model.parse(load(new URL(`../scenes/${f}`, import.meta.url)))
const noise = docOf('noise.json')
const sdf = w => w.slice(w.indexOf('fn SDF('))

// ---- the test as a whole
ok('a bench-kind test at 1280 x 720', T.kind === 'bench' && T.size.width === 1280 && T.size.height === 720)
ok('the timing rule is the one documented', T.timed === BENCH.timed && T.warmup === BENCH.warmup && BENCH.timed.max >= BENCH.timed.samples)
ok('36 rows, the frozen Noise library first', T.cases.length === 36 && base.scene.unit === 'mm' && /Noise library/.test(base.label))
{
    // the last two: the materials row and row 1 again, a submission per iteration, the same scene objects (no swap)
    const [m, n] = T.cases.slice(-2), mi = T.cases.findIndex(c => c.label === 'materials (another scene)')
    ok('rows 35-36: materials and row 1 with a submission per iteration, appended so no row moves',
        mi === 32 && m.scene === T.cases[mi].scene && m.rt?.submitEvery === 1 && !m.compile && m.sameTextAs === mi
        && n.scene === base.scene && n.rt?.submitEvery === 1 && n.sameTextAs === 0
        && T.cases.slice(0, -2).every(c => !c.rt?.submitEvery), `${mi} ${m.label} ${n.label}`)
    ok('a stretch with one sample in flight, after the timed samples', T.pipelined === BENCH.pipelined && BENCH.pipelined.samples >= 4)
}
ok('labels are unique', new Set(T.cases.map(c => c.label)).size === T.cases.length)

// ---- every row's settings exist, its camera is complete, its environment is known settings
for (const c of T.cases) {
    const unknown = Object.keys(c.set || {}).filter(k => !(k in UniformSpec) && !(k in c.scene.uniforms))
    ok(`${c.label}: every setting names a uniform`, !unknown.length, unknown.join(', '))
    const env = Object.keys(c.environment || {}).filter(k => !(k in UniformSpec))
    ok(`${c.label}: its environment is renderer settings`, !env.length, env.join(', '))
    ok(`${c.label}: a complete camera`, c.camera && c.camera.mode === 'orbit' && Array.isArray(c.camera.target)
        && c.camera.target.length === 3 && c.camera.distance > 0 && c.camera.fov > 0)
}
const soft = row('softbox emission 0')
ok('the softbox row darkens exactly the emissive material', JSON.stringify(soft.set) === '{"emissiveLuminance_m3":0}'
    && base.scene.uniforms.emissiveLuminance_m3.def > 0)
ok('the settings rows reuse the base scene object (no swap between them), but the one made without its boxes (0.29.0)',
    T.cases.slice(0, 9).every(c => c.unculled ? c.scene !== base.scene && c.scene.unculled : c.scene === base.scene))
// the drift checks: row 1 again, unchanged -- the same scene object, no setting, no compile of their own
const drift = T.cases.filter(c => /drift check/.test(c.label))
ok('two drift checks, after the settings rows and after the unit rows, each row 1 unchanged',
    drift.length === 2 && T.cases[8] === drift[0] && T.cases[23] === drift[1] && /x20/.test(T.cases[22].label)
    && drift.every(c => c.scene === base.scene && !c.set && !c.compile && c.sameTextAs === 0 && JSON.stringify(c.camera) === JSON.stringify(base.camera)
        && JSON.stringify(c.environment) === JSON.stringify(base.environment)))
ok('no other row uses the base scene (the last, a submission per iteration, is row 1 again)', T.cases.filter(c => c.scene === base.scene).length === 10)
ok('no anisotropy or glass row: the Noise library has neither', (noise.materials || []).every(m =>
    !(m.params?.anisotropy) && !(m.params?.transmission)) && !T.cases.some(c => /anisotropy|glass/.test(c.label)))

// ---- the variants are what their labels say
{
    const b = base.scene
    const plain = row('noise materials plain (and no p_local tracking)').scene
    ok('materials plain: no material keeps code', withoutMaterialCode(noise).materials.every(m => m.code === ''))
    ok('...its SDF differs from the base only by the XF_P bookkeeping', (() => {
        const kept = new Set(sdf(plain.wgsl).split('\n'))
        const gone = sdf(b.wgsl).split('\n').filter(l => !kept.has(l)).map(l => l.trim())
        return gone.length > 0 && gone.every(l => /^(XF_P = p;|let xfp_\w+ = XF_P; XF_P = p;|XF_P = xfp_\w+;)$/.test(l))
    })())
    ok('...and localPoint is called in the base, not in it', /localPoint\(/.test(b.wgsl) && !/localPoint\(/.test(plain.wgsl))

    const groups = codedGroups(noise)
    ok('six relief groups in the frozen Noise library', groups.length === 6 && groups.every(g => /relief/.test(g.label)))
    const shapes = ['n19', 'n21', 'n23', 'n25', 'n27', 'n29']
    const none = row('reliefs removed (plain shapes)').scene
    ok('reliefs removed: the document validates', Model.validate(withoutGroupCode(noise)).length === 0)
    ok('...no noise in the SDF', /fbm3\(/.test(sdf(b.wgsl)) && !/fbm3\(/.test(sdf(none.wgsl)))
    ok('...every displaced shape still in it', shapes.every(id => sdf(none.wgsl).includes(`// node ${id}`)))
    ok('...and no group marked as keeping code', !/\/\/ group \w+ \([^)]*\bcode\)/.test(none.wgsl))
    ok('the original document is untouched', codedGroups(noise).length === 6)
    for (const g of groups) {
        const c = T.cases.find(x => x.scene.id === `bench-noise-only-${g.id}`)
        ok(`only ${g.id}: a row, labelled by its relief`, c && c.label.includes(String(g.label).replace(/^rough stone: /, '')), c?.label)
        /* a group that keeps its code has its children emitted in a helper, children_<id>, BEFORE fn SDF (read
           in the generated text), so the shapes are looked for in the whole scene text, and the noise in the
           SDF between that group's marker and the next group's */
        const w = sdf(c.scene.wgsl)
        ok(`only ${g.id}: exactly one relief's noise in the SDF`, (w.match(/fbm3\(/g) || []).length === 1)
        ok(`only ${g.id}: ...the one group marked as keeping code`,
            JSON.stringify([...w.matchAll(/\/\/ group (\w+) \([^)]*\bcode\)/g)].map(m => m[1])) === JSON.stringify([g.id]))
        ok(`only ${g.id}: ...its noise inside that group's block`, (() => {
            const i = w.indexOf(`// group ${g.id} (`), j = w.indexOf('fbm3('), next = w.indexOf('// group ', i + 1)
            return i >= 0 && j > i && (next < 0 || j < next)
        })())
        ok(`only ${g.id}: every shape still there`, shapes.every(id => c.scene.wgsl.includes(`// node ${id}`)))
    }

    /* THE SHELL ROW: the six reliefs' code as the builder writes it now, nothing else changed -- and the frozen base
       still the relief it was frozen with, or row 1 would stop being comparable with the runs before it */
    const shellRow = row('reliefs in a shell (as the builder writes them now)')
    const shellDoc = withReliefCode(noise, MODIFIERS.relief.code)
    const masked = d => JSON.stringify(d, (k, v) => k === 'code' && typeof v === 'string' && /fbm3\(p \/ size/.test(v) ? '<relief>' : v)
    ok('shell: its own scene, compiled uncached, right after the first drift check',
        shellRow && T.cases[9] === shellRow && shellRow.compile === true && shellRow.scene.id === 'bench-noise-shell' && shellRow.scene !== base.scene)
    ok('shell: every relief\'s code replaced, and only that', codedGroups(shellDoc).length === 6
        && codedGroups(shellDoc).every(g => Model.codeOf(shellDoc, g) === MODIFIERS.relief.code) && masked(shellDoc) === masked(noise))
    ok('shell: the frozen base keeps the relief it was frozen with', codedGroups(noise).every(g => !/NZ_GRAD_VALUE_BOUND/.test(Model.codeOf(noise, g)))
        && MODIFIERS.relief.code !== Model.codeOf(noise, groups[0]))
    const s = shellRow.scene.wgsl
    /* at the root: nothing above reads past the surface (READ_REACH 0) and no CSG group divides for it (DIVIDED_ABOVE
       false), so foldRelief divides as the code did before it read them */
    const atRoot = t => (t.match(/let READ_REACH = 0\.0;/g) || []).length === 6 && !/let READ_REACH = (?!0\.0;)/.test(t)
        && (t.match(/let DIVIDED_ABOVE = false;/g) || []).length === 6 && !/let DIVIDED_ABOVE = (?!false;)/.test(t)
    ok('shell: six reliefs, each skipping its noise at the root (READ_REACH 0, DIVIDED_ABOVE false)',
        atRoot(s) && (s.match(/fbm3\(/g) || []).length === (b.wgsl.match(/fbm3\(/g) || []).length, `${(s.match(/let (READ_REACH|DIVIDED_ABOVE) = [^;]*;/g) || []).join(' | ')}`)
    ok('shell: the uniforms are the base\'s', JSON.stringify(Object.keys(shellRow.scene.uniforms)) === JSON.stringify(Object.keys(b.uniforms)))

    /* THE SHELL WITH THE fBm's OWN STEP BOUND: right after the shell row, the six reliefs' code the shell's with only
       the bound it divides by changed, nothing else in the document */
    const fbmRow = row('reliefs in a shell, step bound measured for their fBm')
    const fbmDoc = withReliefCode(noise, RELIEF_CODE_FBM_BOUND)
    ok('fBm bound: its own scene, compiled uncached, right after the shell row',
        fbmRow && T.cases[10] === fbmRow && fbmRow.compile === true && fbmRow.scene.id === 'bench-noise-shell-fbmlip' && fbmRow.scene !== shellRow.scene)
    ok('fBm bound: every relief\'s code replaced, and only that', codedGroups(fbmDoc).length === 6
        && codedGroups(fbmDoc).every(g => Model.codeOf(fbmDoc, g) === RELIEF_CODE_FBM_BOUND) && masked(fbmDoc) === masked(noise))
    const f = fbmRow.scene.wgsl, sd = t => t.slice(t.indexOf('fn SDF('))
    const differ = (a, c) => { const A = a.split('\n'), C = new Set(c.split('\n')); return A.filter(l => !C.has(l)).map(l => l.trim()) }
    ok('fBm bound: its scene text is the shell row\'s but for the slope line (and the note) in each relief',
        differ(f, s).every(l => /^let slope = 1\.0 \+ amount \/ size \* NZ_RELIEF_LIP_MEASURED \/ peak;$/.test(l) || /^\/\//.test(l))
        && (f.match(/NZ_RELIEF_LIP_MEASURED \/ peak/g) || []).length === 6 && !/NZ_RELIEF_LIP_MEASURED/.test(sd(s)),
        differ(f, s).slice(0, 4).join(' | '))
    ok('fBm bound: READ_REACH 0 and DIVIDED_ABOVE false at the root for all six, as the shell row', atRoot(f))
}

// ---- THE UNIT ROWS: the same physical scene in cm and m, re-authored and converted
{
    const b = sceneOf(noise, 'b')
    const extent = s => s.extent * unitScale(s.unit)
    for (const [label, doc] of [['cm, re-authored', rescaled(noise, 'cm')], ['m, re-authored', rescaled(noise, 'm')],
                                ['m, converted', converted(noise, 'm')], ['x20', rescaled(noise, 'm', 20)]]) {
        const g = sceneOf(doc, 'b')
        ok(`${label}: byte-identical scene WGSL`, g.wgsl === b.wgsl)
        ok(`${label}: the same uniform names`, JSON.stringify(Object.keys(g.uniforms)) === JSON.stringify(Object.keys(b.uniforms)))
        if (label !== 'x20') {
            ok(`${label}: the same physical extent`, near(extent(g), extent(b)), `${extent(g)} vs ${extent(b)}`)
            ok(`${label}: the same surface tolerance, in metres`, near(autoEps(g.extent, g.unit), autoEps(b.extent, b.unit)))
        } else ok('x20: twenty times the physical extent', near(extent(g), 20 * extent(b)))
    }
    /* THE SCENE'S RADIUS is in its units since version 15 (model.js envRadius), so a variant scales it with every
       other length -- the same metres re-authored or converted, twenty times them at x20. Absent stays absent: the
       renderer's 400 m, in any unit, as the bench's own scenes have it. */
    {
        const withR = { ...structuredClone(noise), envRadius: 50 }
        const metres = d => sceneOf(d, 'b').envRadius * unitScale(d.unit)
        ok('the radius: the same metres re-authored in cm and m, and converted', [rescaled(withR, 'cm'), rescaled(withR, 'm'), converted(withR, 'm')]
            .every(d => near(metres(d), metres(withR))), [rescaled(withR, 'cm'), rescaled(withR, 'm'), converted(withR, 'm')].map(metres).join())
        ok('...twenty times them at x20', near(metres(rescaled(withR, 'm', 20)), 20 * metres(withR)))
        ok('...and a scene without one stays without', [rescaled(noise, 'cm'), converted(noise, 'm')].every(d => !('envRadius' in d) && sceneOf(d, 'b').envRadius == null))
    }
    /* re-authored: every uniform unchanged, or a length scaled by exactly k -- a transform's translation
       column and the declared lengths (the reliefs' amount and size among them); rotations and scales untouched */
    const k = lengthScale(noise, 'm'), g = sceneOf(rescaled(noise, 'm'), 'b')
    for (const [name, u] of Object.entries(b.uniforms)) {
        const a = u.def, z = g.uniforms[name].def
        if (/^xf_/.test(name)) ok(`re-authored: ${name} translation x k, the rest unchanged`,
            a.every((v, i) => (i >= 12 && i <= 14) ? near(v * k, z[i]) : near(v, z[i])), `${a} -> ${z}`)
        else if (typeof a === 'number') ok(`re-authored: ${name} unchanged or x k`, near(a, z) || near(a * k, z), `${a} -> ${z}`)
        else if (a && typeof a === 'object' && !Array.isArray(a)) ok(`re-authored: ${name} unchanged or x k`,
            Object.keys(a).every(c => near(a[c], z[c])) || Object.keys(a).every(c => near(a[c] * k, z[c])), `${JSON.stringify(a)} -> ${JSON.stringify(z)}`)
    }
    ok('re-authored: the reliefs\' amount and size scaled', ['amount_n18', 'size_n18'].every(n => near(b.uniforms[n].def * k, g.uniforms[n].def)))
    // converted: parameters untouched, the transform's translation AND scale x k
    const c = sceneOf(converted(noise, 'm'), 'b')
    for (const [name, u] of Object.entries(b.uniforms)) {
        if (!/^xf_/.test(name)) { ok(`converted: ${name} unchanged`, JSON.stringify(u.def) === JSON.stringify(c.uniforms[name].def)); continue }
        const a = u.def, z = c.uniforms[name].def
        const top = noise.root.children.some(n => `xf_${n.id}` === name)      // only top-level nodes are converted
        ok(`converted: ${name} ${top ? 'translation and scale x k' : 'unchanged (a child: its parent carries the scale)'}`,
            a.every((v, i) => top && i >= 12 && i <= 15 ? near(v * k, z[i]) : near(v, z[i])), `${a} -> ${z}`)
    }
    ok('a parameter not declared a length is refused, not rescaled half right', (() => {
        // which are lengths is the block's (model.js version 16)
        const d = structuredClone(noise); Model.blockOf(d, d.root.children[0]).lengths = ['size']
        try { rescaled(d, 'm'); return false } catch (e) { return /rounding/.test(e.message) }
    })())
    /* A PROFILE (a list of points) declared a length: every number in it scaled, its fillets' too, and still a
       list of points -- not an object keyed '0', '1', ... -- and one not declared refused like any other */
    {
        const d = structuredClone(noise), n = d.root.children[0], B = Model.blockOf(d, n)
        n.params = { ...n.params, outline: [[0, 0], [1, 0, 0.2], [0, 1]] }; B.lengths = [...(B.lengths || []), 'outline']
        const k = lengthScale(d, 'm'), got = rescaled(d, 'm').root.children[0].params.outline
        ok('rescaled: a profile declared a length has every number scaled and stays a list of points',
            Array.isArray(got) && JSON.stringify(got) === JSON.stringify([[0, 0], [k, 0, 0.2 * k], [0, k]]), JSON.stringify(got))
        B.lengths = B.lengths.filter(x => x !== 'outline')
        ok('...and one not declared a length is refused', (() => { try { rescaled(d, 'm'); return false } catch (e) { return /outline/.test(e.message) } })())
    }
    /* A PATH ({ path }) likewise: its numbers one level down, which the plain object's case passed over -- scaled,
       fillets too, still a { path }; and not declared a length, refused, not silently left at the old size */
    {
        const d = structuredClone(noise), n = d.root.children[0], B = Model.blockOf(d, n)
        n.params = { ...n.params, route: { path: [[0, 0, 0], [1, 0, 0, 0.2], [1, 1, 0]] } }; B.lengths = [...(B.lengths || []), 'route']
        const k = lengthScale(d, 'm'), got = rescaled(d, 'm').root.children[0].params.route
        ok('rescaled: a path declared a length has every number scaled and stays a { path }',
            JSON.stringify(got) === JSON.stringify({ path: [[0, 0, 0], [k, 0, 0, 0.2 * k], [k, k, 0]] }), JSON.stringify(got))
        B.lengths = B.lengths.filter(x => x !== 'route')
        ok('...and one not declared a length is refused', (() => { try { rescaled(d, 'm'); return false } catch (e) { return /route/.test(e.message) } })())
        // one that names parameters (builder/expr.js): which number in `rise + 0.1` is a length cannot be known
        n.params.route = { path: [[0, 0, 0], [1, 0, 0], [1, 'rise', 0]] }; B.lengths = [...B.lengths, 'route']
        ok('...and one written with parameter names is refused, by name', (() => { try { rescaled(d, 'm'); return false } catch (e) { return /route.*parameter names/.test(e.message) } })())
        n.params.route = { path: [[0, 0, 0], [1, 0, 0]] }
        n.params.outline = [[0, 0], ['rise', 0], [0, 1]]; B.lengths = [...new Set([...B.lengths, 'outline'])]
        ok('...and a profile written with parameter names likewise', (() => { try { rescaled(d, 'm'); return false } catch (e) { return /outline.*profile written with parameter names/.test(e.message) } })())
    }
    // the unit rows point the compile column at the base, which has the same text
    for (const c of T.cases.filter(x => x.sameTextAs !== undefined))
        ok(`${c.label}: its compile cell names a row with the same scene text`, T.cases[c.sameTextAs].scene.wgsl === c.scene.wgsl)
}

// ---- which rows compile uncached: one per distinct scene text worth timing
{
    const compiled = T.cases.map((c, i) => c.compile ? i + 1 : 0).filter(Boolean)
    ok('uncached compiles: the base, the two shell rows, materials plain, reliefs removed, and the five other scenes',
        JSON.stringify(compiled) === JSON.stringify([1, 10, 11, 12, 13, 25, 27, 29, 31, 33]), JSON.stringify(compiled))
    const texts = compiled.map(n => T.cases[n - 1].scene.wgsl)
    ok('...each a different scene text', new Set(texts).size === texts.length)
}

// ---- THE FRAMING, through lib/camera.js itself (it needs only a window listener to exist)
{
    globalThis.addEventListener ??= () => { }
    globalThis.removeEventListener ??= () => { }
    const { CAMERA } = await import('../../lib/camera.js')
    const canvas = { addEventListener() { }, removeEventListener() { }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }), style: {} }
    const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    /* genrays' mapping, backwards (materials_pbr.js ltConnect): a point's place on the image, |x|,|y| < 1 inside */
    const frame = camera => {
        const cam = CAMERA({ canvas, aspect: 1280 / 720, fov: camera.fov, up: [0, 0, 1] })
        cam.set({ mode: camera.mode })
        cam.set({ camtype: camera.camtype, fov: camera.fov, target: camera.target, azimuth: camera.azimuth, elevation: camera.elevation, distance: camera.distance })
        const g = cam.get(), u = cam.getUniforms()
        const x = u.invView.slice(0, 3), y = u.invView.slice(4, 7), z = u.invView.slice(8, 11), fx = u.invProjection[0], fy = u.invProjection[5]
        return { pos: g.pos, project: P => { const d = sub(P, g.pos), zc = -dot(d, z); return zc <= 0 ? null : [dot(d, x) / (zc * fx), dot(d, y) / (zc * fy)] } }
    }
    const corners = b => { const o = []; for (const X of [b.lo[0], b.hi[0]]) for (const Y of [b.lo[1], b.hi[1]]) for (const Z of [b.lo[2], b.hi[2]]) o.push([X, Y, Z]); return o }
    const crosses = (a, p, b) => {          // does the segment a -> p pass through the box b?
        let t0 = 0, t1 = 1
        for (let k = 0; k < 3; k++) {
            const d = p[k] - a[k]
            if (Math.abs(d) < 1e-12) { if (a[k] < b.lo[k] || a[k] > b.hi[k]) return false; continue }
            let u = (b.lo[k] - a[k]) / d, v = (b.hi[k] - a[k]) / d
            if (u > v) [u, v] = [v, u]
            t0 = Math.max(t0, u); t1 = Math.min(t1, v)
            if (t0 > t1) return false
        }
        return true
    }
    for (const [f, key] of [['noise.json', 'noise'], ['surfaces.json', 'surfaces']]) {
        const d = docOf(f), root = d.root       // the document, not Model.toTree: the tree drops the labels
        const emissive = new Set(d.materials.filter(m => (m.params?.emissiveLuminance ?? 0) > 0).map(m => m.id))
        const softbox = root.children.find(n => emissive.has(n.material))
        const t = softbox.transform, s = softbox.params.size
        ok(`${key}: the softbox is axis-aligned (its box below is exact)`, t.rot.x === 0 && t.rot.y === 0 && t.rot.z === 0 && t.scale === 1)
        const box = { lo: [t.pos.x - s.x, t.pos.y - s.y, t.pos.z - s.z], hi: [t.pos.x + s.x, t.pos.y + s.y, t.pos.z + s.z] }
        /* the objects' corners, exact for what these two files hold (read in them): spheres ('radius') and boxes
           ('size' is the half-size, the rounding inside it), some inside a relief group that moves and turns
           them and raises the surface by up to its 'amount'. Each through its chain of frames (bounds.js
           toParent), so a turned box's corners are where they are. A sphere's box corners lie outside it:
           stricter than the object, never looser. */
        const pts = []
        const walk = (n, frames, pad) => {
            if (n.enabled === false) return
            const here = n.transform ? [n.transform, ...frames] : frames
            if (n.kind === 'object' && n !== softbox && n.label !== 'floor') {
                const P = n.params, h = P.radius !== undefined ? [P.radius, P.radius, P.radius] : [P.size.x, P.size.y, P.size.z]
                ok(`${key}: ${n.id} is a sphere or a box (the corners below are exact)`, h.every(Number.isFinite))
                for (const c of corners({ lo: h.map(v => -v - pad), hi: h.map(v => v + pad) })) pts.push(here.reduce((q, t) => toParent(t, q), c))
            }
            for (const c of n.children || []) walk(c, here, pad + (n.kind === 'group' && Model.codeOf(d, n) ? (n.params?.amount ?? 0) : 0))
        }
        for (const c of root.children) walk(c, [], 0)
        ok(`${key}: twelve objects framed`, pts.length === 12 * 8, `${pts.length / 8}`)
        const F = frame(CAMERAS[key])
        const pr = pts.map(F.project)
        ok(`${key}: every object in front of the camera and inside the frame`, pr.every(p => p && Math.abs(p[0]) < 1 && Math.abs(p[1]) < 1),
            JSON.stringify(pr.filter(p => !p || Math.abs(p[0]) >= 1 || Math.abs(p[1]) >= 1).slice(0, 3)))
        ok(`${key}: the softbox is out of the frame`, corners(box).map(F.project).every(p => !p || Math.abs(p[0]) >= 1 || Math.abs(p[1]) >= 1))
        ok(`${key}: the softbox is in front of no object`, !pts.some(P => crosses(F.pos, P, box)))
        ok(`${key}: the camera is below the softbox`, F.pos[2] < box.lo[2], `camera at ${F.pos[2].toFixed(1)}, softbox from ${box.lo[2]}`)
    }
    for (const c of T.cases) {
        const F = frame(c.camera)
        ok(`${c.label}: the target is in front of the camera`, (() => { const p = F.project(c.camera.target); return p && Math.abs(p[0]) < 1e-6 && Math.abs(p[1]) < 1e-6 })())
    }
    // the variants' cameras follow their scenes
    for (const [l, unit, f] of [['in cm, re-authored', 'cm', 1], ['in m, re-authored', 'm', 1], ['in m, converted (as a paste)', 'm', 1], ['physically x20 (m)', 'm', 20]]) {
        const c = row(l), k = lengthScale(noise, unit, f)
        ok(`${l}: the camera scaled by the same factor`, near(c.camera.distance, CAMERAS.noise.distance * k)
            && c.camera.target.every((v, i) => near(v, CAMERAS.noise.target[i] * k)) && c.camera.azimuth === CAMERAS.noise.azimuth)
    }
}

/* ---- THE RUNNER'S 'bench' PATH, against a renderer that records instead of rendering. Only a GPU can time it,
   but everything around the clock can run here, and a kind nothing executes is code that has never run
   (CLAUDE.md): every row offscreen at the test's size, the row's own settings and camera, the sample rule, the
   uncached compiles where asked, the user's state put back, and a report with every row in it. The clock's
   minimums are set to 0 so the rule's sample counts decide. */
{
    const { makeTestBench } = await import('../../lib/pathtracer/tests.js')
    const log = []
    const userSettings = { values: { maxiter: 999, lt: 1, eps: 0.5 }, camera: { mode: 'fps', pos: [1, 2, 3], target: [0, 0, 0] }, size: { mode: 'fit' } }
    const userScene = { id: 'user', uniforms: {} }
    let offscreen = null, timing = false, canTime = true
    const wfOn = []
    const applied = [], compiled = []
    const RT = {
        scene: userScene, cam: { get: () => ({}), set: () => { } },
        settings: () => structuredClone(userSettings),
        applySettings: s => { applied.push(structuredClone(s)); return [] },
        get: () => ({ maxiter: 999 }),
        set: v => { log.push({ set: { ...v } }); return [] },
        setScene: async s => { RT.scene = s; log.push({ scene: s.id }) },
        running: () => true, pause: () => log.push('pause'), resume: () => log.push('resume'),
        size: () => ({ mode: 'fit' }), setSize: () => { },
        beginOffscreen: async size => { offscreen = { ...size, n: 0, timing: [], inFlight: [], submitEvery: [] }; log.push({ begin: size, budget: RT.budget }) },
        // a frame leaves the adaptive budget where the engine's controller put it (raytrace_main.js)
        // ...and says how long it took to record (raytrace_main.js R.recordMs): 3, 4, 5, 6 ms in turn
        // (each call's inFlight and the engine's submitEvery kept, to see which stretch ran how)
        renderFrame: async (n, onProgress, signal, o = {}) => {
            offscreen.n += n; offscreen.timing.push(timing); offscreen.inFlight.push(o.inFlight ?? 1); offscreen.submitEvery.push(RT.submitEvery)
            RT.budget = 15; RT.recordMs = 3 + (offscreen.n - 1) % 4
        },
        endOffscreen: async () => { log.push({ end: offscreen.n, timing: offscreen.timing, inFlight: offscreen.inFlight, submitEvery: offscreen.submitEvery, after: timing }); offscreen = null },
        // the kernels timed on the GPU (core/kerneltime.js): the same numbers every sample
        timeKernels: on => (timing = !!on && canTime),
        kernelTimes: async () => timing ? { ms: { march: 10, shade: 5, occlude: 2, genrays: 0.5 }, count: { march: 24, shade: 24, occlude: 24, genrays: 1 }, passes: 73, overflow: 0,
            spanMs: 20, gapMs: 2.5,
            // in pass order (kerneltime.js tally): generation, then two iterations, then resolve
            seq: [['genrays', 0.5], ['prep_march', 0], ['march', 8], ['prep_shade', 0], ['shade', 4], ['flip', 0],
                  ['prep_march', 0], ['march', 2], ['prep_shade', 0], ['shade', 1], ['occlude', 2], ['flip', 0], ['resolve', 0.25]] } : null,
        // the wavefront log (raytrace_main.js R.wavefrontLog): two iterations, the second with a twentieth of the rays
        wavefrontLog: async on => { wfOn.push(!!on); return !!on },
        // ...with the sample's cut shadow rays as running totals: 0, then 9
        wavefrontCounts: async () => ({ logged: 2, iterations: [{ marched: 1000, shaded: 800, occluded: 0, flushed: 0, shadowCut: 0 },
                                                                 { marched: 50, shaded: 40, occluded: 700, flushed: 4, shadowCut: 9 }] }),
        sampleTags: async () => null,             // a sampler that finds nothing: every box stays unknown
        compileUncached: async (s, o = {}) => {
            compiled.push(o.sequential ? `${s.id} one at a time` : s.id)
            const bad = s.id === 'bench-noise-noreliefs'        // one scene whose lt_build fails, as the first run's did
            return { ms: o.sequential ? 2345 : 1234, slowest: 'shade 1200', readyAt: bad ? { shade: 1200, lt_build: 'failed' } : { shade: 1200 }, failed: bad ? ['lt_build'] : [],
                     ...(o.sequential ? { each: { shade: 1200, march: 300 }, moduleMs: 40 } : {}) }
        },
        prog_wvfmarch: { wgsl: 'march' }, prog_wvfshade: { wgsl: 'shade' }, prog_wvfocclude: { wgsl: 'occlude' },
    }
    const ctx = { RT, Q: { w: 800, h: 600 }, COST: { lat: 0 },
        WG: { device: { queue: { onSubmittedWorkDone: async () => { } }, adapterInfo: { vendor: 'test' } } } }
    const runner = makeTestBench(ctx)
    const fast = { ...T, warmup: { samples: 3, ms: 0 }, timed: { samples: 4, ms: 0, max: 64 }, kernels: { samples: 4, ms: 0, max: 16 } }
    const say = console.log
    console.log = () => { }                 // the runner prints its report; the assertions below read it
    let rows, text
    try { ({ rows, text } = await runner.run(fast)) } finally { console.log = say }
    const begins = log.filter(e => e.begin), ends = log.filter(e => e.end !== undefined)
    ok('runner: every row rendered offscreen at 1280 x 720', begins.length === 36 && begins.every(e => e.begin.width === 1280 && e.begin.height === 720))
    ok('runner: every row 3 warm-up + 4 timed samples, 8 with one in flight, then 4 with its kernels timed, then 1 with the wavefront log',
        ends.every(e => e.end === 20), JSON.stringify(ends.map(e => e.end)))
    ok('...the in-flight stretch one call after the timed samples, every other call one at a time',
        ends.every(e => JSON.stringify(e.inFlight) === JSON.stringify([1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1])), JSON.stringify(ends[0].inFlight))
    ok('runner: a submission per iteration in the last two rows only, and put back after',
        ends.every((e, i) => e.submitEvery.every(v => (v === 1) === (i >= 34))) && RT.submitEvery === undefined,
        ends.map(e => e.submitEvery[0]).join(' '))
    ok('...the in-flight stretch one submission a sample, except where the row sets its own',
        ends.every((e, i) => e.submitEvery[7] === (i >= 34 ? 1 : 1e6) && e.submitEvery.filter(v => v === 1e6).length === (i >= 34 ? 0 : 1)),
        ends.map(e => e.submitEvery[7]).join(' '))
    ok('runner: ms a sample with one in flight, and each timed sample\'s wall clock and recording in the JSON',
        rows.every(r => typeof r.pipelinedMs === 'number' && r.pipelinedSamples === 8 && r.msSamples.length === 4
            && JSON.stringify(r.recordSamples) === '[6,3,4,5]') && /record ms +pipelined +cut/.test(text), JSON.stringify(rows[0].recordSamples))
    ok('...the kernels timed only AFTER the timed samples, and switched off before the row ends',
        ends.every(e => JSON.stringify(e.timing) === JSON.stringify([...Array(8).fill(false), ...Array(5).fill(true)]) && e.after === false))
    ok('...the wavefront log on for that one sample a row and off after it', wfOn.length === 2 * 36 && wfOn.every((on, i) => on === (i % 2 === 0)), wfOn.join(' '))
    ok('runner: the wavefront per iteration, beside its kernels -- rays from the log, ms from the passes between prep_march and flip',
        rows.every(r => r.wavefront?.length === 2 && r.wavefront[0].marched === 1000 && r.wavefront[0].march === 8 && r.wavefront[1].occlude === 2
            && r.wavefront[1].gpu === 5) && /"wavefront"/.test(text), JSON.stringify(rows[0].wavefront))
    ok('runner: the tail -- iterations under a tenth of the first one\'s rays, and their GPU ms; the gaps between kernels',
        rows.every(r => r.wavefrontTailMs === 5 && r.wavefrontTailIterations === 1 && r.wavefrontIterationsMs === 17 && r.gpuGapMs === 2.5 && r.gpuSpanMs === 20)
        && /gaps +tail ms/.test(text), `${rows[0].wavefrontTailMs} ${rows[0].gpuGapMs}`)
    ok('runner: the shadow rays the logged sample cut short, and per iteration; the camera rays it flushed',
        rows.every(r => r.shadowCut === 9 && r.flushed === 4 && r.wavefront[1].cut === 9 && r.wavefront[0].cut === 0)
        && /cut/.test(text), `${rows[0].shadowCut} ${JSON.stringify(rows[0].wavefront)}`)
    /* the timed samples are the 4th to the 7th a row renders (after 3 warm-up): n = 4..7 record 6, 3, 4, 5 ms. The kernel-
       timed and logged samples after them are not counted: they record timestamp writes and a snapshot pass besides. */
    ok('runner: the median recording time over the timed samples only', rows.every(r => r.recordMs === 4.5), String(rows[0].recordMs))
    ok('runner: the iteration budget the timed samples ran at, in the JSON', rows.every(r => r.budget === 15 && 'budgetUsed' in r && 'budgetFlushed' in r))
    ok('...and sample by sample, warm-up and timed, with the readings the row started from',
        rows.every(r => JSON.stringify(r.budgetWarmup) === '[15,15,15]' && JSON.stringify(r.budgetTimed) === '[15,15,15,15]'
            && r.budgetStart && 'used' in r.budgetStart && 'flushed' in r.budgetStart), JSON.stringify(rows[0].budgetWarmup))
    ok('runner: gpu ms, march, surface, shade and occlude per row; every kernel and the samples\' wall clock in the JSON',
        rows.every(r => r.gpuMs === 17.5 && r.kernelMs.march === 10 && r.kernelMs.shade === 5 && r.kernelMs.occlude === 2 && r.kernelMs.genrays === 0.5
            && r.kernelSamples === 4 && typeof r.kernelWallMs === 'number' && r.kernelPasses.march === 24)
        && /gpu ms +march +surface +shade +occlude/.test(text) && /"kernelMs"/.test(text) && !/none --/.test(text))
    ok('runner: a row per case, each with its counts', rows.length === 36 && rows.every(r => r.timedSamples === 4 && r.warmupSamples === 3))
    ok('runner: the live loop paused for the run and resumed after', log[0] === 'pause' && log.at(-1) === 'resume')
    ok('runner: every row starts from its own worst-case budget, not the one the row before it left',
        begins.every(e => e.budget === 0), begins.map(e => e.budget).join(' '))
    const boxWrite = e => e.set && Object.keys(e.set).some(k => /^bx(lo|hi)_/.test(k))
    const sets = log.filter(e => e.set && !boxWrite(e)).map(e => e.set)
    ok('runner: settings start from the schema defaults, not the session', sets[0].eps === UniformSpec.eps.def && sets[0].maxiter === UniformSpec.maxiter.def)
    ok('runner: the scene\'s own environment is applied', sets[0].envMode === 1 && sets[0].studioIlluminance === 150)
    ok('runner: the row\'s change goes over it', sets[1].lt === 0 && sets[3].envMode === 0)
    // ...as a pinhole: the page's lens (0.43.0) is the user's depth of field, and no row's (tests.js stageBench)
    const pinhole = c => ({ aperture: 0, focus: 0, ...c })
    ok('runner: each row\'s camera, target included, a pinhole', applied.slice(0, 36).every((s, i) => JSON.stringify(s.camera) === JSON.stringify(pinhole(T.cases[i].camera))))
    ok('runner: the user\'s settings, camera and size put back', JSON.stringify(applied.at(-1)) === JSON.stringify(userSettings))
    ok('runner: the user\'s scene put back', RT.scene === userScene)
    // swapped only when the row's scene differs from the last: the base, its boxes-off scene and the base again for
    // the first drift check, 14 variants, the base again for the second, 5 other scenes each with its boxes-off scene
    // after it, the materials repeat (after its boxes-off scene, a swap since 0.29.0), the base for the last row, then
    // the user's back
    ok('runner: a scene swapped in only when it changes', log.filter(e => e.scene).length === 3 + 14 + 1 + 2 * 5 + 1 + 1 + 1, log.filter(e => e.scene).map(e => e.scene).join(' '))
    /* ONE UNCACHED COMPILE A ROW since 0.20.3: the one-at-a-time compile only when a test asks (compileSequential) --
       a third compile of every compile row, whose question is answered (tests.js) */
    ok('runner: uncached compiles exactly where asked, all at once only',
        JSON.stringify(compiled) === JSON.stringify(T.cases.filter(c => c.compile).map(c => c.scene.id)), compiled.join(' '))
    ok('runner: no one-at-a-time compile unless asked, its column empty', rows.every(r => r.compileSeqMs === undefined) && /compile seq/.test(text))
    {
        // ...and asked for: rows 1, 13 (a kernel that fails) and 14 (no compile)
        const n = compiled.length, seq = { ...fast, compileSequential: true, cases: [0, 12, 13].map(i => fast.cases[i]) }
        console.log = () => { }
        let r3
        try { r3 = await runner.run(seq) } finally { console.log = say }
        ok('runner: the one-at-a-time compile when a test asks -- its total, each kernel alone, the module without a pipeline',
            JSON.stringify(compiled.slice(n)) === JSON.stringify([0, 12].flatMap(i => [T.cases[i].scene.id, `${T.cases[i].scene.id} one at a time`]))
            && r3.rows[0].compileSeqMs === '2345' && r3.rows[0].compileSeqEach.march === 300 && r3.rows[0].moduleMs === 40 && r3.rows[1].compileSeqMs === '1 failed'
            && r3.rows[2].compileSeqMs === undefined && /compile seq/.test(r3.text), `${compiled.slice(n).join(' ')} | ${r3.rows[0].compileSeqMs} ${r3.rows[1].compileSeqMs}`)
    }
    ok('runner: the compile column -- ms, "= row 1", or "-"', rows[0].compileMs === '1234' && rows[19].compileMs === '= row 1'
        && rows[8].compileMs === '= row 1' && rows[13].compileMs === '-' && rows[0].compileSlowest === 'shade 1200',
        `${rows[0].compileMs} ${rows[19].compileMs} ${rows[8].compileMs} ${rows[13].compileMs}`)
    ok('runner: a kernel that failed to compile is the cell, not a time; the JSON names it and keeps the time',
        rows[12].compileMs === '1 failed' && JSON.stringify(rows[12].compileFailed) === '["lt_build"]' && rows[12].compileMsAll === 1234
        && rows[0].compileFailed.length === 0 && / 1 failed /.test(text), `${rows[12].compileMs} ${JSON.stringify(rows[12].compileFailed)}`)
    /* THE BOXES: every row measures its document's (the stand-in's sampler finds nothing, so all unknown) and
       writes them before its offscreen render begins, without restarting the picture */
    const tops = c => Object.keys(c.scene.uniforms).filter(k => /^bxlo_/.test(k)).length
    // the Noise library's six relief groups: its eight plain shapes have no box test since 0.34.0 (codegen.js ONLY THE DEAR ONES)
    ok('runner: every row reports its boxes, known/total top-level nodes', rows.every((r, i) => r.boxes === `0/${tops(T.cases[i])}`) && tops(base) === 6,
        `tops(base) ${tops(base)}; ` + rows.map((r, i) => [i + 1, r.boxes, tops(T.cases[i])]).filter(([, b, n]) => b !== `0/${n}`).slice(0, 6).join(' ; '))
    ok('runner: the nodes without a box named in the JSON, with why', rows[0].boxesUnknown?.length === 6
        && rows[0].boxesUnknown.every(u => /: not measured yet$/.test(u)) && /"boxesUnknown"/.test(text), JSON.stringify(rows[0].boxesUnknown?.slice(0, 2)))
    {
        // ...each row whose scene has boxes: one made without them (a "boxes off" row) has none to write
        let ok2 = true, box = false, at = 0
        for (const e of log) { if (boxWrite(e)) box = true; if (e.begin) { ok2 = ok2 && (box || tops(T.cases[at]) === 0); box = false; at++ } }
        // none: the six "boxes off" rows, and Surface materials' own (no dear node since 0.34.0)
        ok('runner: the boxes written before each row\'s render begins (none for a row made without them)', ok2 && T.cases.filter(c => tops(c) === 0).length === 7)
    }
    /* 0.29.0: culling off is a scene made without its boxes (codegen.js `cull`), not the uniform `cull` 0 */
    const boxTests = S => /\bcullDist\(/.test(S.wgsl) && Object.keys(S.uniforms).some(k => /^bxlo_/.test(k))
    /* ...and a scene with no dear node (0.34.0: Surface materials) has no box test either way: its "boxes off" row is the row
       before's text, and says so ("= row") */
    ok('runner: a "boxes off" row is the row before it made without its boxes -- no box test, no box uniform -- and no row sets `cull`',
        T.cases.filter(c => c.unculled).length === 6 && T.cases.every((c, i) => !c.unculled || (c.scene.unculled === true && !boxTests(c.scene)
            && T.cases[i - 1].scene !== c.scene && T.cases[i - 1].scene.title === c.scene.title
            && (boxTests(T.cases[i - 1].scene) ? c.sameTextAs === undefined : c.sameTextAs === i - 1 && T.cases[i - 1].scene.wgsl === c.scene.wgsl)))
        && T.cases.filter(c => c.unculled && c.sameTextAs !== undefined).map(c => c.label).join() === 'Surface materials, bounding boxes off'
        && T.cases.every(c => !('cull' in (c.set || {}))) && !sets.some(v => 'cull' in v))
    ok('runner: the report says how it was measured, where and when', /1280x720 offscreen .* one sample per trace, each awaited, wall clock/.test(text)
        && /browser: /.test(text) && /date: /.test(text) && /timing wall clock/.test(text) && /compile ms/.test(text))
    ok('runner: every row in the table, with a fingerprint', T.cases.every(c => text.includes(c.label)) && rows.every(r => /^[0-9a-f]{8}$/.test(r.code)))
    ok('runner: the JSON carries the size and each row\'s camera', /"size": \{/.test(text) && rows.every(r => r.camera && r.camera.target))
    {
        // a device without timestamp-query: no kernel samples, empty cells, and the report says why once
        canTime = false; log.length = 0
        const two = { ...fast, cases: fast.cases.slice(0, 2) }
        console.log = () => { }
        let r2
        try { r2 = await runner.run(two) } finally { console.log = say }
        const e2 = log.filter(e => e.end !== undefined)
        ok('no timestamp-query: no kernel samples, the cells empty, one line saying why',
            e2.every(e => e.end === 15) && r2.rows.every(r => r.gpuMs === undefined && r.kernelsNote === 'no timestamp-query on this device')
            && (r2.text.match(/gpu ms, march, surface, shade, occlude: none -- no timestamp-query on this device/g) || []).length === 1, e2.map(e => e.end).join(' '))
        canTime = true
    }

    // BENCH.view(n): row n's scene, stage and camera in the live view, the loop running, nothing restored
    log.length = 0; applied.length = 0
    RT.scene = userScene
    const said = await runner.view(T, 25)
    ok('view: row 25 is Surface materials, swapped in, its camera applied, the loop running',
        RT.scene === T.cases[24].scene && JSON.stringify(applied[0].camera) === JSON.stringify(pinhole(CAMERAS.surfaces)) && log.at(-1) === 'resume' && /Surface materials/.test(said))
    ok('view: a row that does not exist says so', await runner.view(T, 37).then(() => false, e => /no row 37/.test(e.message)))
}

/* ---- THE UNCACHED DEVICE (core/profile.js profileWG): the guard on the WORKGROUP id -- on gid, Tint refused
   lt_build's barriers (the user's Chrome, 2026-09-29) -- and every kernel async, the caller's options kept */
{
    const P = await import('../../lib/pathtracer/core/profile.js')
    const calls = []
    const dev = P.profileWG({ makeCompute: (...a) => (calls.push(a), {}), device: 'D' }, 4242)
    dev.makeCompute('BODY', 'MAIN', { u: 'f32' }, { r: 'buf' }, { wg: [64, 1, 1] })
    dev.makeCompute('BODY', 'MAIN')
    const [a, b] = calls
    ok('profileWG: the guard first, on wid, at a number no workgroup id reaches',
        a[1] === P.guardLine(4242) + 'MAIN' && /^if \(wid\.x == (\d+)u\) \{ return; \}/.test(a[1]) && +a[1].match(/== (\d+)u/)[1] >= 2 ** 31
        && +a[1].match(/== (\d+)u/)[1] < 2 ** 32, a[1].split('\n')[0])
    ok('profileWG: async forced, the caller\'s options kept', a[4].async === true && a[4].wg[0] === 64 && b[4].async === true)
    ok('profileWG: uniforms, resources and the rest of the device passed through', a[2].u === 'f32' && a[3].r === 'buf' && dev.device === 'D')
    const fresh = Array.from({ length: 50 }, () => { const c = []; P.profileWG({ makeCompute: (...x) => (c.push(x), {}) }).makeCompute('B', 'M'); return c[0][1] })
    ok('profileWG: a fresh number each time a device is made (its default nonce)', new Set(fresh).size === 50
        && fresh.every(g => /^if \(wid\.x == \d+u\)/.test(g)))
}

/* ---- THE SMALL SCENES' ROWS (lib/pathtracer/tests.js small-caustic, small-emitter; 0.9.1), through the runner's
   'image' path over a renderer that records instead of rendering, with the real lib/camera.js. Only a GPU can say
   what they read; here, that they ask for what their labels say: the light-tracing mask taken on the row's own scene
   from its own camera (it was taken before either was set -- harmless while lt, with neither, was the only test with
   a mask), each row on the scene its label names, the photon square and the emitter grid that scene's radius gives
   (photometry.js derive, as the engine computes them), the old 2 cm margin only where a row says so, and no setting
   the renderer does not have. */
{
    const { makeTestBench, TESTS } = await import('../../lib/pathtracer/tests.js')
    const { CAMERA } = await import('../../lib/camera.js')
    const { derive } = await import('../../lib/pathtracer/core/photometry.js')
    const userScene = { id: 'user', uniforms: {}, unit: 'm' }
    const state = Object.fromEntries(Object.entries(UniformSpec).map(([k, s]) => [k, structuredClone(s.def)]))
    const log = []
    const cam = CAMERA({ aspect: 64 / 48, fov: 40, up: [0, 0, 1] })
    const RT = {
        scene: userScene, cam,
        settings: () => ({}), applySettings: () => [],
        get: () => ({ ...state }),
        set(v) {
            const unknown = Object.keys(v).filter(k => !(k in UniformSpec) && !(k in (RT.scene.uniforms || {})))
            for (const [k, x] of Object.entries(v)) if (!unknown.includes(k)) state[k] = x
            return unknown
        },
        setScene: async s => { RT.scene = s; log.push({ scene: s.id }) },
        running: () => false, pause: () => { }, resume: () => { }, size: () => ({}), setSize: () => { },
        clearAccums: async () => { },
        step: async n => log.push({ step: n, scene: RT.scene, state: { ...state }, camera: cam.get() }),
        imageStats: async mask => ({ meanLuma: 1, noise: 0.1, masked: mask === 'mask' }),
        ltMask: async () => { log.push({ mask: RT.scene.id, camera: cam.get() }); return 'mask' },
        ltStats: async () => ({ topCellShare: 0.1, connPerPhoton: 0.01, ltNoise: 0.2, ltReach: 0.05 }),
        readPixel: async () => ({ L: 1, se: 0.01, rgb: [1, 1, 1] }),
    }
    const ctx = { RT, Q: { w: 64, h: 48 }, COST: { lat: 0, reset() { } },
        WG: { device: { queue: { onSubmittedWorkDone: async () => { } }, adapterInfo: { vendor: 'test' } } } }
    const runner = makeTestBench(ctx)
    const warns = [], say = console.log, warn = console.warn
    console.log = () => { }; console.warn = (...a) => warns.push(a.join(' '))
    const runs = {}
    cam.set({ aperture: 0.7, focus: 9 })                               // the user's lens, which no row may keep
    const lens0 = { aperture: cam.get().aperture, focus: cam.get().focus }
    try { for (const id of ['small-caustic', 'small-emitter', 'lens']) { log.length = 0; runs[id] = { ...(await runner.run(TESTS.find(t => t.id === id))), log: [...log] } } }
    finally { console.log = say; console.warn = warn }
    const grids = e => derive(e.state, { unit: e.scene.unit, envRadius: e.scene.envRadius })
    {
        const { rows, log } = runs['small-caustic'], T = TESTS.find(t => t.id === 'small-caustic')
        const mask = log.find(e => e.mask)
        const at = log.map((e, i) => e.step ? i : -1).filter(i => i >= 0)     // the mask pass's samples, then each row's
        ok('small-caustic: the mask taken on its own scene (radius 5 cm), after its own pass and before any row',
            !!mask && mask.mask === 'bench-ball-cm-r5' && at[0] < log.indexOf(mask) && log.indexOf(mask) < at[1], JSON.stringify(mask))
        ok('...from its own camera', !!mask && near(mask.camera.distance, T.camera.distance) && mask.camera.target.every((v, i) => near(v, T.camera.target[i])), JSON.stringify(mask?.camera))
        const steps = log.filter(e => e.step).slice(1)                  // the first is the mask pass's
        ok('small-caustic: a row per case, each read inside the mask', rows.length === 6 && steps.length === 6 && rows.every(r => r.masked), `${rows.length} rows, ${steps.length} steps`)
        ok('...each on the scene its label names, its square what that scene\'s radius makes it', steps.every((e, i) => {
            const small = /radius 5 cm/.test(T.cases[i].label), g = grids(e)
            return e.scene.id === (small ? 'bench-ball-cm-r5' : 'bench-ball-cm') && near(g.ltHalf, small ? 0.05 : 15)     // metres (0.36.0)
        }), steps.map(e => `${e.scene.id}:${grids(e).ltHalf}`).join(' '))
        ok('...light tracing on and off, and learned or not, as labelled', steps.every((e, i) => {
            const L = T.cases[i].label
            return (e.state.lt === (/light tracing off/.test(L) ? 0 : 1)) && (/light tracing off/.test(L) || e.state.ltLearn === (/learned/.test(L) ? 1 : 0))
        }), steps.map(e => `${e.state.lt}/${e.state.ltLearn}`).join(' '))
    }
    {
        const { rows, log } = runs['small-emitter'], T = TESTS.find(t => t.id === 'small-emitter')
        const steps = log.filter(e => e.step)
        ok('small-emitter: a row per case', rows.length === 6 && steps.length === 6)
        ok('...each on the scene its label names, its emitter grid what that scene\'s radius makes it', steps.every((e, i) => {
            const small = /radius 6 cm/.test(T.cases[i].label), g = grids(e)
            return e.scene.id === (small ? 'bench-disc-cm-r6' : 'bench-disc-cm') && near(g.emitHalf, small ? 0.06 : 15)     // metres (0.36.0)
        }), steps.map(e => `${e.scene.id}:${grids(e).emitHalf}`).join(' '))
        ok('...the old 2 cm margin only where a row says so, automatic elsewhere', steps.every((e, i) => e.state.emitMargin === (/old/i.test(T.cases[i].label) ? 0.02 : 0)),
            steps.map(e => e.state.emitMargin).join(' '))
        ok('...sun and sky off, the disc a 1 cm one in a cm scene', steps.every(e => e.state.sunIlluminance === 0 && e.state.skyIlluminance === 0 && e.state.tDiscR === 0.5 && e.scene.unit === 'cm'))
        ok('...read by the disc\'s sensors', rows.every(r => Array.isArray(r.discRatio) && r.discRatio.length === 4))
    }
    {
        // THE LENS ROW (0.43.0): each lens's two rows on one camera, light tracing on then off; the pinhole as a pinhole
        const { rows, log } = runs.lens, T = TESTS.find(t => t.id === 'lens')
        const steps = log.filter(e => e.step).slice(1)                  // the first is the mask pass's
        ok('lens: a row per case, each read inside the mask, on the ball scene', rows.length === 5 && steps.length === 5
            && rows.every(r => r.masked) && steps.every(e => e.scene.id === 'bench-ball-cm-r5'), `${rows.length} rows, ${steps.length} steps`)
        ok('...each with the aperture its label names, focused on the target, light tracing as labelled', steps.every((e, i) => {
            const L = T.cases[i].label, mm = +(/lens (\d+) mm/.exec(L)?.[1] ?? 0)
            return Math.abs(e.camera.aperture - mm / 10) < 1e-12 && e.camera.focus === 0 && e.state.lt === (/light tracing off/.test(L) ? 0 : 1)
        }), steps.map(e => `${e.camera?.aperture}/${e.state.lt}`).join(' '))
        ok('...the mask pass from the test\'s camera, a pinhole', log.find(e => e.mask)?.camera.aperture === 0)
        ok('small-caustic: every row a pinhole, the user\'s lens notwithstanding', runs['small-caustic'].log.filter(e => e.step).every(e => e.camera.aperture === 0))
        ok('...and the user\'s lens put back after each test', cam.get().aperture === lens0.aperture && cam.get().focus === lens0.focus, JSON.stringify(cam.get()))
    }
    ok('the small scenes\' rows ask for no setting the renderer lacks', !warns.some(w => /unknown uniform/.test(w)), warns.join(' | '))
    ok('the user\'s scene is put back after each', RT.scene === userScene)
}

console.log(fail ? `bench: ${pass} passed, ${fail} FAILED` : `bench: ${pass} passed, 0 failed`)
process.exit(fail ? 1 : 0)
