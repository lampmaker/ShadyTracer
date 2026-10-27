/* A BACKTICK IN A WGSL COMMENT ENDS THE SHADER, and I have now done it six times.
   The shaders are JS template literals, so a backtick written as markdown around an
   identifier terminates the string mid-kernel. The symptom is never the cause: sometimes a
   JS syntax error pointing at a random word ("Unexpected identifier 'a'"), sometimes a WGSL
   compile error for a function that is suddenly out of scope, sometimes -- worst -- a page
   that simply never renders.

   Run: node lib/pathtracer/core/check-shaders.mjs

   THE PARSE IS THE TEST. Whether a backtick matters depends on whether it is inside a
   template literal, which a line-by-line scan cannot know (a backtick in a comment in
   ordinary JS is fine, and plenty of these files have one). So: try to import every module,
   and only when one fails go looking for the likely culprit and name it.

   IT CHECKS THE SCENES TOO, and that is not a nicety. It used to scan only its own
   directory, so when the sixth one landed in scenes/common.js it reported
   "10 modules parse" and the page was broken anyway. A checker that is trusted and does not
   cover the file you just edited is worse than no checker: it converts "I should look" into
   "it passed". Every directory holding WGSL in a template literal goes in ROOTS.

   AND IT LINTS lib/pathtracer FOR THE MISTAKES THAT ARE ALWAYS MISTAKES, in a third pass, if
   eslint is installed. That pass exists because the import above happily accepts a reference to
   a variable that is out of scope -- valid syntax, a ReferenceError only when that line runs --
   and three bugs in a row hid behind a feature flag nothing exercised. See core/lint.config.mjs.

   IT ALSO BUILDS EVERY KERNEL, in a second pass below, and checks two things a driver would
   otherwise have to find: that nothing the source names is undeclared, and that the bind group
   fits. Both were shipped broken on the same day this pass was written -- see its own header.

   AND, IF naga IS INSTALLED, IT COMPILES EVERY KERNEL FOR REAL, in a fourth pass: the one thing
   the other three cannot do is see a WGSL type error. See that pass's header.

   AND IT UNDERSTANDS BLOCK COMMENTS, which the same failure taught it. The old scan only
   flagged lines STARTING with a comment marker, and the backtick that broke common.js was on
   a continuation line six lines into a block comment -- so even after the import failed, the
   report pointed nowhere near it. */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')          // lib/pathtracer/core -> repo root

/** Every directory whose .js files carry WGSL. Add one when a new host or scene set appears. */
const ROOTS = [
    'lib/pathtracer/core',
    'lib/pathtracer',
    'lib/pathtracer/optics',
    /* the Darkroom's viewer and its writers (0.79.0): no WGSL, but the page imports them through index.js, and a folder
       reached only through another module's import is a folder this list once forgot (the count above) */
    'lib/pathtracer/darkroom',
    'lib/pathtracer/darkroom/export',
    'scenes',
    'builder',
    'optics',
    'lib/shell',                    // no WGSL, but the host page imports it: a parse error there is a page that never starts
    /* the same for the page's other imports: the library (and its studio, a second renderer) and the
       report. They were missed when added -- the count here stayed at 75 while they shipped unparsed */
    '.',                            // the application's own root: start.js, version.js, diagnose.js
    'library',
    'library/items',
    /* the timeline tool and the library it mounts (vendored; the page imports it now) */
    'tools',
    'lib/timeline',
    'bench',     // the benchmark's scenes and variants (below)
    'workspace', // the projects kept in the browser: the page imports it at start
    'help',      // the help panel (0.55.0): the page imports it at start
]

/** Lines holding an unescaped backtick inside a comment -- the usual cause.
 *  Tracks /* *\/ block state so a continuation line is caught, not just an opener. */
const suspects = src => {
    const out = []
    let inBlock = false
    src.split('\n').forEach((line, i) => {
        const t = line.trim().replace(/\\`/g, '')
        const opens = line.lastIndexOf('/*'), closes = line.lastIndexOf('*/')
        const startedInBlock = inBlock
        if (opens > closes) inBlock = true
        else if (closes > opens) inBlock = false
        if (!t.includes('`')) return
        if (startedInBlock || inBlock || t.startsWith('//'))
            out.push(`      line ${i + 1}: ${t.slice(0, 88)}`)
    })
    return out
}

let bad = 0, total = 0
for (const root of ROOTS) {
    const dir = join(repo, root)
    if (!existsSync(dir)) { console.log(`(no such directory: ${root})`); continue }
    for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
        const path = join(dir, f)
        total++
        try { await import(pathToFileURL(path).href) }
        catch (e) {
            bad++
            console.log(`WILL NOT PARSE  ${relative(repo, path)}\n      ${e.message.slice(0, 140)}`)
            const s = suspects(readFileSync(path, 'utf8'))
            if (s.length) console.log('   likely cause -- backtick inside a comment:\n' + s.join('\n'))
        }
    }
}
/* AND THE HOST PAGES' OWN SCRIPT. The page's inline module is JavaScript nothing imports, so a
   stray brace in it -- which is how the Builder toolbar commit shipped -- passed everything
   here and left a page that never starts. `node --check` parses it without running it. */
const PAGES = ['app.html']
const { mkdtempSync, writeFileSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const scratch = mkdtempSync(join(tmpdir(), 'page-script-'))
for (const page of PAGES) {
    const html = readFileSync(join(repo, page), 'utf8')
    const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)]
    scripts.forEach((m, i) => {
        total++
        // blank lines in front, so a reported line number is the page's own
        const pre = '\n'.repeat(html.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length - 1)
        const file = join(scratch, `page${i}.mjs`)
        writeFileSync(file, pre + m[1])
        const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
        if (r.status !== 0) {
            bad++
            console.log(`WILL NOT PARSE  ${page} (inline script ${i + 1})\n      `
                + String(r.stderr).replace(file, page).split('\n').slice(0, 5).join('\n      '))
        }
    })
}
if (bad) {
    console.log(`\n${bad} file(s) broken. Fix these before the kernel checks can run.`)
    process.exit(1)
}
console.log(`${total} modules and page scripts parse.`)

/* ==================================================================================================
   PASS TWO: THE KERNELS THEMSELVES, without a GPU.

   WHY THIS EXISTS. Pass one only proves the JavaScript parses. It said "24 modules parse" on the
   day prog_guide_build shipped with an EMPTY module string -- so GUIDE_CELLS was unresolved and
   that pipeline failed to compile at startup, for everyone, and nothing noticed because nothing
   dispatches it unless guiding is on and pipeline creation is async: the rejection lands long
   after the call that caused it. The same report carried a second failure of the same shape,
   prog_shade growing a ninth storage binding past the default limit of eight.

   Neither needs a driver to find. Both are arithmetic over the source the kernel is BUILT from,
   and the way to get that source without a device is to hand the builders a WG that only records
   what it was asked to compile.

   THE TABLE IS EXPLICIT, and it has to be: the builders take their arguments in four different
   orders. A kernel missing from it is a kernel unchecked, which is the same trap ROOTS sets above
   -- so add the line when you add the kernel.
================================================================================================== */
const W = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/wavefront.js')).href)
const G = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/genrays.js')).href)
const PK = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/pick.js')).href)
const { PROBE_MAIN } = await import(pathToFileURL(join(repo, 'builder/validate.js')).href)
const { computeUniformTypes } = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/uniforms.schema.js')).href)
const FD = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/field.js')).href)
const { WEBGPU } = await import(pathToFileURL(join(repo, 'lib/tinywebgpu/src/tinywebgpu.js')).href)
/* THE BUILDER'S OUTPUT IS A SCENE TOO, and it was the one scene this pass never saw: the three
   hand-written scenes were the only callers the kernels were checked against, while the
   builder emits its own SDF shape through a different path. The demo scene (scenes/demo.json,
   compiled with the bundled scenes below) covers every kind of block codegen emits -- a
   transform, a plain union, a smooth CSG group, group code -- so a generated scene goes through
   every kernel on every run. */
const { generate } = await import(pathToFileURL(join(repo, 'builder/codegen.js')).href)
/* AND ONE THE DEMO MUST NOT BE: a material that reads p_local. That path costs an SDF evaluation
   per hit, so the demo does not use it -- which would make it a mode nothing compiles. This
   scene exists only to put it through every kernel: a CSG group (the XF_SUB bookkeeping), a
   transformed object inside it, and the local-point material on it. */
const Model = await import(pathToFileURL(join(repo, 'builder/model.js')).href)
const localDoc = Model.createDoc({ title: 'p_local coverage' })
Model.addMaterial(localDoc, { id: 'fixed', code: 'm.baseColor = fract(p_local);' })
Model.addGroup(localDoc, 'root', { id: 'cut', blend: 0.1 })
/* a light first: never drawn in a CSG group, left out of the combine for its uniforms (codegen children()) --
   so the base is the object after it, and that has to compile in every kernel too */
Model.addLight(localDoc, 'cut', { id: 'cutlamp', shape: 'disc' })
Model.addObject(localDoc, 'cut', { id: 'base', material: 'fixed',
    transform: { pos: { x: 1, y: 0, z: 0 }, rot: { x: 0, y: 30, z: 0 }, scale: 2 } })
Model.addObject(localDoc, 'cut', { id: 'hole', join: 'subtract' })
Model.addObject(localDoc, 'root', { id: 'lone', material: 'fixed' })
/* AND EVERY PRIMITIVE, one of each, taken from PRIMITIVES itself so a primitive added to the
   library is compiled here without anyone remembering to list it -- and the blank code node the
   menu's "code (WGSL)" makes. */
const { OBJECT_CODE_TEMPLATE } = await import(pathToFileURL(join(repo, 'builder/codegen.js')).href)
const { PRIMITIVES } = await import(pathToFileURL(join(repo, 'builder/primitives.js')).href)
const primDoc = Model.createDoc({ title: 'every primitive' })
for (const primitive of Object.keys(PRIMITIVES)) Model.addObject(primDoc, 'root', { primitive })
Model.addObject(primDoc, 'root', { code: OBJECT_CODE_TEMPLATE })
/* and the two things the scene conversions rest on: a compile-time loop bound (Menger's
   iteration count as a u32 const) and a helper from the functions block */
primDoc.functions = 'fn halfOf(x: f32) -> f32 { return 0.5 * x; }'
Model.addObject(primDoc, 'root', { params: { iterations: 3, size: 2.0 }, constants: { iterations: 'u32' },
    code: 'C = add_new(C, Nmenger(p / halfOf(size), iterations), MATERIAL);' })
/* and a material with parameters of its own -- a colour, a live number, a compile-time one --
   read by its code, on the first primitive */
Model.addMaterial(primDoc, { id: 'striped', params: {}, code: [
    'for (var i = 0u; i < bands; i++) { m.roughness *= 0.9; }',
    'm.baseColor = mix(m.baseColor, stripe, step(fract(p.x / width), 0.5));'].join('\n') })
Model.addParam(primDoc, 'striped', 'stripe', { r: 1, g: 0, b: 0 })
Model.addParam(primDoc, 'striped', 'width', 0.5)
Model.addParam(primDoc, 'striped', 'bands', 3)
Model.setConstant(primDoc, 'striped', 'bands', 'u32')
Model.setMaterial(primDoc, primDoc.root.children[0].id, 'striped')
/* and an EXPORT BOX (builder/exportbox.js): it draws nothing but declares its uniforms -- a
   transform and a vec3 size -- which every kernel then carries, and no bundled scene has one */
Model.addExportBox(primDoc, 'root', { id: 'printbox', size: { x: 2, y: 2, z: 1 } })
/* and PROFILES (roadmap/BUILDER.md §6 phase 3): the functions codegen writes per profile parameter and the three it
   writes after them, reached through handles -- one extruded, one revolved with an edge on the axis and fillets
   either way round, one called as a bare 2D distance, and two profiles on one node */
Model.addObject(primDoc, 'root', { id: 'extruded', params: { outline: [[-0.5, -0.4], [0.5, -0.4, 0.1], [0.2, 0.0, 0.05], [0.5, 0.4], [-0.5, 0.4, 0.1]], height: 0.3 },
    code: 'C = add_new(C, extrude(outline, p, height), MATERIAL);' })
Model.addObject(primDoc, 'root', { id: 'turned', params: { knob: [[0, -0.5], [0.6, -0.5, 0.1], [0.6, 0.1], [0.25, 0.3, 0.15], [0.4, 0.6, 0.1], [0, 0.6]] },
    code: 'C = add_new(C, revolve(knob, p), MATERIAL);' })
Model.addObject(primDoc, 'root', { id: 'flat', params: { a: [[0, 0], [1, 0], [0, 1]], b: [[0, 0], [1, 0, 0.1], [1, 1], [0, 1]] },
    code: 'let g = profile(a, p.xy);\nC = add_new(C, g2Extrude(p, g2Max(g, profile(b, p.xy)), 0.1), MATERIAL);' })
/* and PATHS (phase 4): the two functions codegen writes per path parameter and the ones after them -- a tube rounded
   and flat along a path with a sharp corner and a fillet tighter than the tube, a profile swept along a path in 3D
   with a fillet tighter than the profile reaches, and two paths on one node. (A path in a scene with no profile, where
   pathCross is the circle alone and there is no sweep, is in the group-code scene below.) */
Model.addObject(primDoc, 'root', { id: 'tubes', params: { route: { path: [[0, 0, 0], [1, 0, 0], [1, 1, 0, 0.05], [1, 1, 1]] }, radius: 0.1 },
    code: 'C = add_new(C, tube(route, p, radius, 1.0), MATERIAL);\nC = add_new(C, tube(route, p + VEC3(0.0, 0.0, 0.5), radius, 0.0), MATERIAL);' })
Model.addObject(primDoc, 'root', { id: 'guide', params: { route: { path: [[0, 0, 0], [1, 0, 0, 0.05], [1, 1, 0, 0.3], [1, 1, 1]] },
    section: [[-0.15, -0.1], [0.15, -0.1, 0.03], [0.15, 0.1, 0.03], [-0.15, 0.1]] },
    code: 'C = add_new(C, sweep(route, section, p), MATERIAL);' })
/* and LIVE PATHS (2026-10-01): pieces as uniforms -- mat4 columns, a vec4 frame, the ok guard -- a tube with a sharp
   corner and a named point, rounded and flat, and a profile swept along one; and a compiled path whose points name
   parameters (its numbers read in JS, literals as any compiled path's) */
Model.addObject(primDoc, 'root', { id: 'livetube', params: { rise: 0.6, route: { path: [[0, 0, 0], [1, 0, 0], [1, 1, 0, 0.05], [1, 1, 'rise']], live: true } },
    code: 'C = add_new(C, tube(route, p, 0.1, 1.0), MATERIAL);\nC = add_new(C, tube(route, p - VEC3(0.0, 0.0, 0.5), 0.1, 0.0), MATERIAL);' })
Model.addObject(primDoc, 'root', { id: 'liveguide', params: { w: 1, route: { path: [[0, 0, 0], ['w', 0, 0, 0.05], ['w', 'w', 0]], live: true },
    section: [[-0.15, -0.1], [0.15, -0.1, 0.03], [0.15, 0.1, 0.03], [-0.15, 0.1]] }, code: 'C = add_new(C, sweep(route, section, p), MATERIAL);' })
Model.addObject(primDoc, 'root', { id: 'namedpath', params: { h: 0.5, route: { path: [[0, 0, 0], [0, 0, 'h * 2']] } },
    code: 'C = add_new(C, tube(route, p, 0.05, 1.0), MATERIAL);' })
/* and LIVE PROFILES (2026-10-02): mat2x4 pieces, the axis and convex numbers, the guard, the reach -- a live extrude
   with a named point and fillet, a live revolve with an edge on the axis, a live profile swept along a path (its reach
   read live), and a compiled outline with names */
Model.addObject(primDoc, 'root', { id: 'liveplate', params: { w: 0.6, r: 0.05, plate: [[0, 0], ['w', 0, 'r'], ['w', 0.4], [0.3, 0.2, 'r'], [0, 0.4]] },
    code: 'C = add_new(C, extrude(plate, p, 0.2), MATERIAL);' })
Model.setProfileLive(primDoc, 'liveplate', 'plate', true)
Model.addObject(primDoc, 'root', { id: 'liveknob', params: { rad: 0.5, knob: [[0, -0.5], ['rad', -0.5, 0.1], ['rad', 0.5], [0, 0.5]] },
    code: 'C = add_new(C, revolve(knob, p), MATERIAL);' })
Model.setProfileLive(primDoc, 'liveknob', 'knob', true)
Model.addObject(primDoc, 'root', { id: 'livesection', params: { w: 0.15, route: { path: [[0, 0, 0], [1, 0, 0, 0.3], [1, 1, 0]] },
    section: [['-w', -0.1], ['w', -0.1, 0.03], ['w', 0.1, 0.03], ['-w', 0.1]] }, code: 'C = add_new(C, sweep(route, section, p), MATERIAL);' })
Model.setProfileLive(primDoc, 'livesection', 'section', true)
Model.addObject(primDoc, 'root', { id: 'namedoutline', params: { s: 0.3, sq: [[0, 0], ['s', 0], ['s', 's'], [0, 's']] },
    code: 'C = add_new(C, extrude(sq, p, 0.1), MATERIAL);' })
/* and PATHS WITH A SCALE AND TWIST PER POINT (2026-10-02; core/shapes.js pathWGSL vary): compiled, their values literals
   -- a tube tapered through a sharp corner and a fillet, rounded (round cones) and flat; a profile turned and scaled
   in x and y apart -- and live (the twisted bar preset above, its twist a named parameter) */
Model.addObject(primDoc, 'root', { id: 'varytube', params: { route: { path: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 2], [1, 1, 0, 0.2, 0.5], [1, 1, 1, 0, 1.5]] } },
    code: 'C = add_new(C, tube(route, p, 0.1, 1.0), MATERIAL);\nC = add_new(C, tube(route, p + VEC3(0.0, 0.0, 0.5), 0.1, 0.0), MATERIAL);' })
Model.addObject(primDoc, 'root', { id: 'varysweep', params: { route: { path: [[0, 0, 0], [1, 0, 0, 0, 1.5, 0.5, 45], [1, 1, 0, 0.3, 0.8, 1.2, 90], [1, 1, 1, 0, 1, 1, 180]] },
    section: [[-0.15, -0.1], [0.15, -0.1, 0.03], [0.15, 0.1, 0.03], [-0.15, 0.1]] }, code: 'C = add_new(C, sweep(route, section, p), MATERIAL);' })
Model.addObject(primDoc, 'root', { id: 'twopaths', params: { a: { path: [[0, 0, 0], [0, 0, 1]] }, b: { path: [[0, 0, 0], [1, 0, 0, 0.2], [1, 0, 1]] } },
    code: 'C = add_new(C, tube(a, p, 0.05, 0.0), MATERIAL);\nC = add_new(C, tube(b, p, 0.05, 1.0), MATERIAL);' })
/* AND GROUP CODE, which the demo has one plain case of. Every modifier preset (from MODIFIERS, so
   a new one is compiled here unasked), and the combinations the children function has to
   survive: code on a CSG group, a coded group as a CSG child, one coded group inside another,
   children called twice, a compile-time parameter, a p_local material under a warp (XF_SUB and
   XF_P through a function), and a coded group with no children to call. */
const { MODIFIERS, modifierGroup } = await import(pathToFileURL(join(repo, 'builder/modifiers.js')).href)
const groupDoc = Model.createDoc({ title: 'group code coverage' })
Model.addMaterial(groupDoc, { id: 'fixed', code: 'm.baseColor = fract(p_local);' })
for (const key of Object.keys(MODIFIERS)) {
    const g = Model.addGroup(groupDoc, 'root', { ...modifierGroup(key), id: `mod${key}` })
    Model.addObject(groupDoc, g.id, { primitive: 'box', material: 'fixed' })
}
Model.addGroup(groupDoc, 'root', { id: 'cutcode', blend: 0.1,
    code: 'C = children(C, p);\nC = children(C, p + VEC3(0.0, 0.0, 2.0));' })
Model.addObject(groupDoc, 'cutcode', { primitive: 'box' })
Model.addGroup(groupDoc, 'cutcode', { id: 'inner', join: 'subtract', params: { depth: 2, lift: 0.5 }, constants: { depth: 'u32' },
    code: 'for (var i = 0u; i < depth; i++) { p.z -= lift; }\nwarp(0.9);\nC = children(C, p);' })
Model.addGroup(groupDoc, 'inner', { id: 'innermost', code: '/* nested */ C = children(C, p * 1.0);' })
Model.addObject(groupDoc, 'innermost', { primitive: 'sphere', material: 'fixed' })
Model.addGroup(groupDoc, 'root', { id: 'lonely', code: 'C = children(C, p);' })
Model.addObject(groupDoc, 'root', { id: 'pipe', params: { route: { path: [[0, 0, 0], [1, 0, 0, 0.3], [1, 1, 0]] } },
    code: 'C = add_new(C, tube(route, p, 0.1, 0.0), MATERIAL);' })
/* AND THE RELIEF'S SHELL under each kind of parent (codegen.js READ_REACH, DIVIDED_ABOVE): the modifier above sits
   at the root (0, false); here it is under a smooth CSG group (5/4 of the blend's live value, an expression; true,
   its distance divided by the group) and inside another group's code (unbounded, false) -- three texts for its
   branch */
Model.addGroup(groupDoc, 'root', { id: 'blended', blend: 0.1 })
Model.addObject(groupDoc, 'blended', { primitive: 'box' })
Model.addGroup(groupDoc, 'blended', { ...modifierGroup('relief'), id: 'reliefblended' })
Model.addObject(groupDoc, 'reliefblended', { primitive: 'sphere' })
Model.addGroup(groupDoc, 'lonely', { ...modifierGroup('relief'), id: 'reliefcoded' })
Model.addObject(groupDoc, 'reliefcoded', { primitive: 'sphere' })
/* AND A GROUP OF EVERY JOIN (model version 14: a join per child), in a turned, scaled frame: a base with a
   p_local material, a union, a subtraction with its own blend, an intersection, an export box and a light
   between them (not shapes of it), a smooth union nested in it that joins by subtraction with a blend of its own
   (its blend_ and its jblend_ both), a relief joining with its own blend (SURFACE_ONLY then the conjunction of
   every blend), and group code over mixed joins (the combine inside a children function). The golden cases
   (builder/test/fixtures/csg-v10) cover what version 10 could say; this is what it could not. */
const mixedDoc = Model.createDoc({ title: 'every join' })
Model.addMaterial(mixedDoc, { id: 'fixed', code: 'm.baseColor = fract(p_local);' })
Model.addGroup(mixedDoc, 'root', { id: 'mx', blend: 0.02, transform: { pos: { x: 0, y: 1, z: 0 }, rot: { x: 10, y: 0, z: 30 }, scale: 1.5 } })
Model.addObject(mixedDoc, 'mx', { id: 'mxa', primitive: 'box', material: 'fixed' })
Model.addObject(mixedDoc, 'mx', { id: 'mxb', primitive: 'sphere', join: 'union' })
Model.addExportBox(mixedDoc, 'mx', { id: 'mxbox' })
Model.addObject(mixedDoc, 'mx', { id: 'mxc', primitive: 'cylinder', join: 'subtract', joinBlend: 0.05 })
Model.addLight(mixedDoc, 'mx', { id: 'mxlamp', shape: 'rectangle' })
Model.addObject(mixedDoc, 'mx', { id: 'mxd', primitive: 'torus', join: 'intersect' })
Model.addGroup(mixedDoc, 'mx', { id: 'mxin', blend: 0.1, join: 'subtract', joinBlend: 0.03 })
Model.addObject(mixedDoc, 'mxin', { primitive: 'sphere' }); Model.addObject(mixedDoc, 'mxin', { primitive: 'capsule' })
/* ...and LIGHTS DRAWN FROM INSIDE ITS SHAPES (codegen collectLights, emitHoisted; the user, 2026-10-03): one in a moved
   plain group that is one of mx's shapes (OpticsBench2's laser), and one in the nested CSG group mxin -- each drawn
   after mx's combine, through the frames of the groups between, entered for it alone. mxlamp above is the light
   straight in the CSG group. Compiled off and live (builder-live-joins below). */
Model.addGroup(mixedDoc, 'mx', { id: 'mxrig', transform: { pos: { x: 0, y: 0.3, z: 0.2 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
Model.addObject(mixedDoc, 'mxrig', { primitive: 'cylinder' })
Model.addLight(mixedDoc, 'mxrig', { id: 'mxriglamp', shape: 'disc', transform: { pos: { x: -0.5, y: 0, z: 0 }, rot: { x: -90, y: 0, z: 0 }, scale: 1 } })
Model.addLight(mixedDoc, 'mxin', { id: 'mxinlamp', shape: 'disc' })
Model.addGroup(mixedDoc, 'mx', { ...modifierGroup('relief'), id: 'mxrel', joinBlend: 0.04 })
Model.addObject(mixedDoc, 'mxrel', { primitive: 'sphere' })
Model.addGroup(mixedDoc, 'root', { id: 'mxcode', code: 'C = children(C, p);' })
Model.addObject(mixedDoc, 'mxcode', { primitive: 'box' })
Model.addObject(mixedDoc, 'mxcode', { primitive: 'sphere', join: 'subtract', joinBlend: 0.1 })
Model.addObject(mixedDoc, 'mxcode', { primitive: 'cylinder', join: 'intersect' })
/* AND A GRAIN (SURFACES.md phase 1): R_local and p_local together, on a CSG child and under a warp
   -- the two places the recorded frame is not simply the object's (XF_SUB; warp() zeroes XF_M) */
Model.addMaterial(localDoc, { id: 'grained', code: 'm.anisotropy = 0.8;\nm.tangent = grainAround(R_local, p_local, VEC3(0.0, 0.0, 1.0));' })
Model.setMaterial(localDoc, 'hole', 'grained')
Model.addMaterial(groupDoc, { id: 'brushed', code: 'm.tangent = grainAlong(R_local, VEC3(1.0, 0.0, 0.0)) + grainRadial(R_local, p_local, VEC3(0.0, 0.0, 1.0));' })
Model.addObject(groupDoc, 'innermost', { primitive: 'box', material: 'brushed' })
/* AND THE NOISE LIBRARY (noise.js) in material code, every function; the SDF side is the 'relief'
   modifier, which MODIFIERS brings in above */
Model.addMaterial(groupDoc, { id: 'noisy', code: [
    'let q = p_local * S_local * perMm(0.5);',
    'let a = vnoise3(q, 1u); let b = gnoise3(q, 2u); let c = fbm3(q, 3u, 3u, 2.0, 0.5); let w = worley3(q, 4u); let x = worley3x(q, 5u);',
    'm.roughness = clamp(0.5 + 0.1 * (a.w + b.w + c.w) + 0.2 * (w.y - w.x + x.y - x.x) + 0.01 * length(a.xyz + b.xyz + c.xyz), 0.0, 1.0);',
    'm.baseColor = m.baseColor * mix(0.8, 1.0, w.z) * (1.0 + 0.0 * nzFbmLip(3u, 2.0, 0.5, NZ_GRAD_LIP + NZ_VALUE_LIP));'].join('\n') })
Model.addObject(groupDoc, 'root', { primitive: 'sphere', material: 'noisy' })
/* AND A MATERIAL'S RELIEF (builder/materials.js RELIEFS): the one part of a material in the SDF, a wrapper
   around every object wearing it (codegen object()). Every preset, worn: by a plain box, by two objects at
   once (one function, two call sites), by an object under a warp (XF_K saved and put back by the coded
   group), inside nested group code, by a CSG child in the p_local scene (XF_SUB around its private Hit);
   and a relief of one's own with a parameter of its own, a compile-time amplitude, next to a material
   whose own parameter shares the relief's name. */
const { RELIEFS } = await import(pathToFileURL(join(repo, 'builder/materials.js')).href)
for (const key of Object.keys(RELIEFS)) {
    Model.addMaterial(groupDoc, { id: `rel${key}` })
    Model.setRelief(groupDoc, `rel${key}`, key)
    Model.addObject(groupDoc, 'root', { primitive: 'box', material: `rel${key}` })
}
Model.addObject(groupDoc, 'root', { primitive: 'sphere', material: 'relnoise' })
Model.addObject(groupDoc, 'modtwist', { primitive: 'cylinder', material: 'relripple' })
Model.addObject(groupDoc, 'innermost', { primitive: 'torus', material: 'relhammered' })
Model.addMaterial(groupDoc, { id: 'relown', params: { size: 3 }, code: 'm.roughness = 0.2 + 0.0 * size;' })
Model.setRelief(groupDoc, 'relown', 'noise')
Model.addParam(groupDoc, 'relown#relief', 'twist', 0.5)
Model.setConstant(groupDoc, 'relown#relief', 'amplitude', 'f32')
groupDoc.materials.find(m => m.id === 'relown').relief.code = 'h = amplitude * sin(q.x / size + twist);\nslope = amplitude / size;'
Model.addObject(groupDoc, 'root', { primitive: 'capsule', material: 'relown' })
/* AND A MATERIAL'S COATING (builder/materials.js coating, 0.39.0): in the shader only while a material has one,
   written as one coatMaterial call after its fields -- each place it can be (entry faces with an AR or a bare back,
   every face), on glass and on an opaque plastic, and a material whose own code calls coatMaterial over it. No
   bundled scene has one, so without this the line codegen writes would never be compiled. */
for (const coat of [1, 2, 3]) {
    Model.addMaterial(groupDoc, { id: `coat${coat}`, preset: coat === 2 ? 'plastic' : 'glass' })
    groupDoc.materials.find(m => m.id === `coat${coat}`).params.coating = coat
    Model.addObject(groupDoc, 'root', { primitive: 'box', material: `coat${coat}` })
}
groupDoc.materials.find(m => m.id === 'coat3').code = 'm = coatMaterial(m, 1u, 0.5, 0.5, 550.0, 0.0, 1.8);'
/* AND A DISPERSIVE GLASS (materials.js abbe, 0.40.0): its Abbe number in the shader only while above 0 -- a prism of it */
Model.addMaterial(groupDoc, { id: 'flint', preset: 'glass', params: { ...Model.MATERIAL_PRESETS.glass.params(), ior: 1.75, abbe: 28 } })
Model.addObject(groupDoc, 'root', { primitive: 'prism', material: 'flint' })
/* AND A GROUP WHOSE MATERIALS DO NOT FOLLOW ITS WARP (model.js setStraightMaterial): the material frame set at a
   twist, moved by every transform inside it, read by a relief and by a p_local, carried through a coded group
   (a mirror) and a CSG group inside it -- the one path where XF_Q, XF_QM, XF_QS and XF_STRAIGHT are written */
Model.addGroup(groupDoc, 'root', { ...modifierGroup('twist'), id: 'straighttw' })
Model.setStraightMaterial(groupDoc, 'straighttw', true)
Model.addObject(groupDoc, 'straighttw', { primitive: 'box', material: 'rellayers' })
Model.addObject(groupDoc, 'straighttw', { primitive: 'sphere', material: 'fixed' })
Model.addGroup(groupDoc, 'straighttw', { ...modifierGroup('mirror'), id: 'straightmir' })
Model.addObject(groupDoc, 'straightmir', { primitive: 'cylinder', material: 'rellayers' })
Model.addGroup(groupDoc, 'straighttw', { id: 'straightcut' })
Model.addObject(groupDoc, 'straightcut', { primitive: 'box', material: 'fixed' })
Model.addObject(groupDoc, 'straightcut', { primitive: 'sphere', material: 'rellayers', join: 'subtract' })
/* AND PATTERN FRAMES (model.js setPattern, version 24; codegen patIn): no example need have one, so each place the
   frame is written is here -- an object at the top level and a CSG group (its own fold) in the p_local scene; a relief
   read in one, plainly and inside the straight twist (XF_Q moved by it); a p_local material inside the straight group
   (XF_STRAIGHT already set, its XF_QM turned further); the shell modifier's (an after group: round its code) */
const turned = { pos: { x: 0.1, y: 0, z: -0.2 }, rot: { x: 0, y: 90, z: 15 } }
Model.setPattern(localDoc, 'lone', turned)
Model.setPattern(localDoc, 'cut', turned)
Model.setPattern(groupDoc, Model.addObject(groupDoc, 'root', { primitive: 'box', material: 'rellayers' }).id, turned)
Model.setPattern(groupDoc, Model.addObject(groupDoc, 'straighttw', { primitive: 'torus', material: 'rellayers' }).id, turned)
Model.setPattern(groupDoc, Model.addObject(groupDoc, 'straighttw', { primitive: 'capsule', material: 'fixed' }).id, turned)
Model.setPattern(groupDoc, 'modshell', turned)
/* AND A RELIEF IN A SMOOTH BLEND (codegen reliefChain): the band widened by every blend above, the distance divided
   once by the outermost group's XF_RL -- written by foldRelief from a material's object inside a plain group and a
   nested CSG, and from a noise relief modifier's code (READ_REACH, DIVIDED_ABOVE), read after the combine; joins of
   their own blends among them, which the reach adds up */
Model.addGroup(groupDoc, 'root', { id: 'printblend', blend: 0.2 })
Model.addObject(groupDoc, 'printblend', { primitive: 'box', material: 'rellayers' })
Model.addGroup(groupDoc, 'printblend', { id: 'printplain' })
Model.addObject(groupDoc, 'printplain', { primitive: 'sphere', material: 'rellayers' })
Model.addGroup(groupDoc, 'printblend', { id: 'printcut', blend: 0.1 })
Model.addObject(groupDoc, 'printcut', { primitive: 'cylinder', material: 'relnoise' })
Model.addObject(groupDoc, 'printcut', { primitive: 'box', join: 'intersect', joinBlend: 0.05 })
Model.addGroup(groupDoc, 'printblend', { ...modifierGroup('relief'), id: 'printrough', joinBlend: 0.15 })
Model.addObject(groupDoc, 'printrough', { primitive: 'sphere', material: 'rellayers' })
Model.addMaterial(localDoc, { id: 'rough', code: 'm.roughness = fract(p_local.x);' })
Model.setRelief(localDoc, 'rough', 'noise')
Model.addObject(localDoc, 'cut', { id: 'dent', primitive: 'sphere', material: 'rough', join: 'subtract' })   // cut, as the group's op meant before joins
Model.addObject(localDoc, 'root', { id: 'pebble', primitive: 'sphere', material: 'rough' })
/* AND THE LIBRARY'S OWN ITEMS (library/items): their material code is WGSL that the store test only
   validates as a document, so without this a library material that does not compile is found by the
   first person to drop it on something. Every item, each material on a sphere of its own. */
const PROF = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/profile.js')).href)
const { ITEM_FILES } = await import(pathToFileURL(join(repo, 'library/items/index.js')).href)
const libraryDoc = Model.createDoc({ title: 'library items' })
for (const file of ITEM_FILES) {
    const data = JSON.parse(readFileSync(join(repo, 'library/items', file), 'utf8'))
    for (const item of data.items ?? [data]) {
        const out = Model.insertAsset(libraryDoc, item.asset, 'root')
        if (item.asset?.kind === 'material') Model.addObject(libraryDoc, 'root', { primitive: 'sphere', material: out.id })
    }
}
/* AND THE BUNDLED SCENES, the JSON documents the page starts its project with -- what a user sees
   is exactly what is compiled here. They replaced the three hand-written scenes this pass was
   first written against, which are gone. */
/* ...AND THE SCENES THAT WERE THE EXAMPLES until 0.54.0, kept as test fixtures (test/fixtures/scenes): the shapes of
   scene they are still have to compile. [path relative to the repository, title] each. */
const { SCENE_FILES } = await import(pathToFileURL(join(repo, 'scenes/index.js')).href)
const { FIXTURE_SCENES } = await import(pathToFileURL(join(repo, 'test/fixtures/scenes/index.js')).href)
const SCENE_PATHS = [...SCENE_FILES.map(f => [join('scenes', f), f]), ...FIXTURE_SCENES.map(f => [join('test/fixtures/scenes', f), `fixtures/${f}`])]
const sceneId = title => title.replace('.json', '').replace(/[^A-Za-z0-9_-]/g, '_')
const bundledScenes = SCENE_PATHS.map(([path, title]) => generate(Model.toTree(Model.parse(
    readFileSync(join(repo, path), 'utf8'))), { id: sceneId(title), title }))
/* AND A RAY LIMITER (model version 10): a material the optics trace sees and the picture does not,
   so its scene has a third and fourth copy (opticsWgsl, opticsPickWgsl) that nothing but the optics
   trace compiles -- and no bundled scene has one. The optics test scene with a limiter disc across
   the beam, as a person would add one to see a cross-section. */
const limiterDoc = Model.parse(readFileSync(join(repo, 'test/fixtures/scenes/optics-test.json'), 'utf8'))
Model.addMaterial(limiterDoc, { id: 'cut', label: 'limiter' })
Model.setMaterialType(limiterDoc, 'cut', 'limiter')
// ...and its light transparent: the clear-sheet branch of a light's face (codegen emitMaterials)
Model.setLight(limiterDoc, 'die', { transparent: true })
Model.addObject(limiterDoc, 'root', { id: 'section', primitive: 'cylinder', material: 'cut', params: { radius: 2, height: 0.01 },
    transform: { pos: { x: 0, y: 0, z: 5 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
/* AND THE BENCHMARK'S SCENES (bench): frozen copies and the variants its rows are made of --
   no material code, re-authored and converted to cm and m, twenty times larger. Only the benchmark builds
   them, so without this a variant that does not compile is found on the other computer, mid-run. */
const benchScenes = [...new Set((await (await import(pathToFileURL(join(repo, 'bench/index.js')).href))
    .benchTest(u => readFileSync(u, 'utf8'))).cases.map(c => c.scene))]
/* ...AND THE BAKED ONES (bench/bake.js, builder/bake.js): every bench scene with its values as
   constants, a text nothing else builds -- vectors and matrices written as WGSL literals, the scene's reads renamed */
const bakedScenes = (await (await import(pathToFileURL(join(repo, 'bench/bake.js')).href))
    .bakeTest(u => readFileSync(u, 'utf8'))).cases.map(c => c.scene).filter(s => s.baked)
/* ...AND THE BAKED ONES WITH ANIMATED VALUES (bench/animated.js): a few values uniforms again among the
   constants -- a mixed text no other scene has */
const animatedScenes = (await (await import(pathToFileURL(join(repo, 'bench/animated.js')).href))
    .animatedTest(u => readFileSync(u, 'utf8'))).cases.filter(c => c.way === 'baked-animated').map(c => c.scene)
/* ...AND THE LIGHTS-IN-AN-ARRAY BENCH'S (bench/lightarray.js): baked, 16 and 256 faces of one light, 16 lights of their own, and
   the arrays' window off (builder/arrays.js) */
const lightArrayScenes = (await (await import(pathToFileURL(join(repo, 'bench/lightarray.js')).href)).lightArrayTest()).cases.slice(0, 6).map(c => c.scene)
const CHECKED_SCENES = [...bundledScenes, ...benchScenes, ...bakedScenes, ...animatedScenes, ...lightArrayScenes,
    generate(Model.toTree(limiterDoc), { id: 'builder-limiter', title: 'builder: an optics limiter' }),
    generate(Model.toTree(primDoc), { id: 'builder-types', title: 'builder: every primitive' }),
    /* AND THE SAME, PATHS AND PROFILES BEING EDITED IN THE PICTURE (codegen emitScene editing, 2026-10-02): compiled ones
       forced live, live ones given room for points more -- slots that are off -- which no saved scene ever has */
    generate(Model.toTree(primDoc), { id: 'builder-edited', title: 'builder: paths and profiles being edited',
        editing: ['livetube.route', 'namedpath.route', 'liveknob.knob', 'namedoutline.sq', 'liveguide.section', 'liveguide.route'] }),
    generate(Model.toTree(localDoc), { id: 'builder-local', title: 'builder p_local' }),
    generate(Model.toTree(groupDoc), { id: 'builder-groupcode', title: 'builder group code' }),
    generate(Model.toTree(libraryDoc), { id: 'builder-library', title: 'builder: every library item' }),
    generate(Model.toTree(mixedDoc), { id: 'builder-joins', title: 'builder: every join' }),
    /* AND THE GOLDEN CSG CASES (builder/test/fixtures/csg-v10): every kind of CSG group codegen emits, whose
       text codegen.test holds frozen -- compiled too, off and live, so the frozen text is also known to build */
    ...[false, true].map(live => {
        const d = Model.parse(readFileSync(join(repo, 'builder/test/fixtures/csg-v10/cases.json'), 'utf8'))
        d.liveVisibility = live
        return generate(...Model.generateArgs(d, { id: `builder-csg-cases${live ? '-live' : ''}`, title: 'builder: the golden CSG cases' }))
    }),
    /* AND core/profile.js's: the one-sphere scene the engine's tests build on, and (below) the benchmark's device */
    /* ...and the benchmark's uncached compile (raytrace_main.js R.compileUncached): every kernel through
       profileWG, which puts a guard line in front of each entry point. _profileDevice routes it below. */
    { ...generate(Model.toTree(localDoc), { id: 'profile-uncached', title: 'benchmark: every kernel uncached' }), _profileDevice: true },
    PROF.sphereScene(generate(Model.toTree(localDoc), { id: 'profile-sphere-base', title: 'profile: the floor' })),
    /* AND LIVE VISIBILITY (codegen liveVisibility): every node behind a u32 uniform, hidden ones kept
       -- over group code, a CSG group whose FIRST child is hidden (the runtime first-flag), and the optics
       scene with its light and its lens hidden. A mode nothing compiles is a mode that has never run. */
    ...(() => {
        const live = structuredClone(groupDoc)
        const cut = Model.addGroup(live, 'root', { id: 'livecut', blend: 0.05 })
        Model.addObject(live, cut.id, { id: 'livebase', primitive: 'box' })
        Model.addObject(live, cut.id, { primitive: 'sphere', join: 'subtract' })
        Model.setEnabled(live, 'livebase', false)
        /* and the group of every join (mixedDoc below), with its base and a middle child hidden: the next shape
           becomes the base at run time, and whatever joins it then must compile */
        const mixed = structuredClone(mixedDoc)
        Model.setEnabled(mixed, 'mxa', false); Model.setEnabled(mixed, 'mxc', false)
        const optics = structuredClone(limiterDoc)
        Model.setEnabled(optics, 'die', false); Model.setEnabled(optics, 'lens', false)
        const prims = structuredClone(primDoc)
        Model.setEnabled(prims, prims.root.children[1].id, false)
        return [[live, 'builder-live-groupcode'], [optics, 'builder-live-optics'], [prims, 'builder-live-types'], [mixed, 'builder-live-joins']]
            .map(([d, id]) => generate(Model.toTree(d, { keepDisabled: true }), { id, title: `${id} (live visibility)`, liveVisibility: true }))
    })(),
    /* AND AN EMPTY ONE: "+ Scene" makes exactly this, compiles it and shows it, so an SDF that
       returns emptyHit untouched and a getMaterial2 with no cases has to build too. */
    generate(Model.toTree(Model.createDoc()), { id: 'builder-empty', title: 'builder: empty scene' }),
    /* AND THE BENCH'S OWN SCENE. tests.js writes one against the scene contract by hand, so the
       photometry test has a known answer; a scene only the bench loads is a scene nothing else
       ever compiles. */
    (await import(pathToFileURL(join(repo, 'lib/pathtracer/tests.js')).href)).testScene('mm', 'plane'),
    (await import(pathToFileURL(join(repo, 'lib/pathtracer/tests.js')).href)).testScene('m', 'sphere'),
    (await import(pathToFileURL(join(repo, 'lib/pathtracer/tests.js')).href)).testScene('m', 'tilted'),
    (await import(pathToFileURL(join(repo, 'lib/pathtracer/tests.js')).href)).testScene('m', 'disc'),
    (await import(pathToFileURL(join(repo, 'lib/pathtracer/tests.js')).href)).testScene('cm', 'sphere'),
    (await import(pathToFileURL(join(repo, 'lib/pathtracer/tests.js')).href)).testScene('m', 'slab'),
    (await import(pathToFileURL(join(repo, 'lib/pathtracer/tests.js')).href)).testScene('m', 'wedge'),
    (await import(pathToFileURL(join(repo, 'lib/pathtracer/tests.js')).href)).testScene('cm', 'ball'),
    // the sppm row's: a glass pane standing on the floor (0.60.0; the manifold row's block in it, 'pool', went in 0.61.0)
    (await import(pathToFileURL(join(repo, 'lib/pathtracer/tests.js')).href)).testScene('m', 'pane'),
    // the integrating sphere's: a hollow shell round the optics source (optics-balance)
    (await import(pathToFileURL(join(repo, 'lib/pathtracer/tests.js')).href)).testScene('m', 'shell'),
    /* AND THE HOST'S BENCH SCENE (builder/lightbench.js, the light-vs-emitter row): a light, the same disc as
       an emissive object, clear and rough glass, live visibility -- the bench alone loads it. */
    (await import(pathToFileURL(join(repo, 'builder/lightbench.js')).href)).lightBench().scene,
    /* AND THE SCENE AS DATA (codegen `data`, builder/scenedata.js): the same documents with their shape as records --
       the blocks, the compiled subtrees, the evaluator, the light faces read from the light table, a storage buffer
       declared as a scene resource in every kernel that compiles the scene. Every bundled scene and every builder case
       above that has structure of its own: CSG of every join, group code, a limiter, p_local, the library's items,
       paths and profiles being edited, hidden nodes. */
    ...SCENE_PATHS.map(([path, title]) => generate(...Model.generateArgs(Model.parse(readFileSync(join(repo, path), 'utf8')),
        { id: `data-${sceneId(title)}`, title: `${title} as data`, data: true }))),
    ...[[limiterDoc, 'limiter'], [primDoc, 'types'], [localDoc, 'local'], [groupDoc, 'groupcode'], [libraryDoc, 'library'], [mixedDoc, 'joins']]
        .map(([d, id]) => generate(...Model.generateArgs(d, { id: `data-builder-${id}`, title: `builder ${id} as data`, data: true }))),
    generate(...Model.generateArgs(primDoc, { id: 'data-builder-edited', title: 'builder: paths and profiles being edited, as data', data: true,
        editing: ['livetube.route', 'namedpath.route', 'liveknob.knob', 'namedoutline.sq', 'liveguide.section', 'liveguide.route'] })),
    generate(...Model.generateArgs(Model.parse(readFileSync(join(repo, 'builder/test/fixtures/csg-v10/cases.json'), 'utf8')),
        { id: 'data-builder-csg-cases', title: 'builder: the golden CSG cases, as data', data: true })),
    generate(...Model.generateArgs(Model.createDoc(), { id: 'data-builder-empty', title: 'builder: empty scene, as data', data: true })),
    /* AND ARRAYS (model.js copies, version 17): a copy loop over a uniform a copy in codegen; the ARRAY records, the
       base frame and its stack as data -- with a CSG group and an array inside, a p_local material (its frame through
       each copy), and an array inside group code (a compiled subtree's loop, as data) */
    ...(() => {
        const d = structuredClone(localDoc)
        const mat = d.materials[0]?.id ?? null
        Model.addGroup(d, 'root', { id: 'arr' })
        Model.addObject(d, 'arr', { id: 'arrb', primitive: 'box', material: mat })
        const cut = Model.addGroup(d, 'arr', { id: 'arrcut', blend: 0.05 })
        Model.addObject(d, cut.id, { primitive: 'box' })
        Model.addObject(d, cut.id, { primitive: 'sphere', join: 'subtract' })
        Model.addGroup(d, 'arr', { id: 'arrin' })
        Model.addObject(d, 'arrin', { primitive: 'sphere', material: mat })
        Model.setCopies(d, 'arrin', Model.copiesRow(2, 1, 'z'))
        Model.setCopies(d, 'arr', [...Model.copiesRow(2, 3), { pos: { x: 0, y: 2, z: 0 }, rot: { x: 10, y: 20, z: 30 }, scale: 0.5 }])
        Model.addGroup(d, 'root', { id: 'arrtw', code: 'C = children(C, p);' })
        Model.addGroup(d, 'arrtw', { id: 'arrsub' })
        Model.addObject(d, 'arrsub', { primitive: 'box' })
        Model.setCopies(d, 'arrsub', Model.copiesRow(3, 1, 'y'))
        return [generate(...Model.generateArgs(d, { id: 'builder-arrays', title: 'builder: arrays' })),
                generate(...Model.generateArgs(d, { id: 'data-builder-arrays', title: 'builder: arrays, as data', data: true }))]
    })(),
    /* AND LIGHTS INSIDE ARRAYS (0.79.0; builder/lights.js A LIGHT INSIDE ARRAYS): a face a copy -- lightFace's copy
       switches, the pick within a light's copies, its cases of every copy's index -- a two-sided rectangle in an array in
       a ring of them, a transparent disc beside it, and a light in a CSG group inside the ring (hoisted after the
       combine, inside the copy loop) with a material's relief in that group (a compiled subtree as data: its lights'
       faces through the copies around it); off, live and as data. */
    ...(() => {
        const d = Model.createDoc({ title: 'lights in arrays' })
        const rough = Model.addMaterial(d, { id: 'lrough' })
        Model.setRelief(d, rough.id, 'hammered')
        Model.addGroup(d, 'root', { id: 'lring', transform: { pos: { x: 0, y: 0, z: 1 }, rot: { x: 0, y: 0, z: 0 }, scale: 2 } })
        Model.addGroup(d, 'lring', { id: 'lrow' })
        Model.addLight(d, 'lrow', { id: 'lrect', shape: 'rectangle', twoSided: true })
        Model.addLight(d, 'lring', { id: 'ldisc', shape: 'disc', transparent: true })
        Model.addGroup(d, 'lring', { id: 'lcut', blend: 0.02 })
        Model.addObject(d, 'lcut', { primitive: 'box', material: rough.id })
        Model.addObject(d, 'lcut', { primitive: 'sphere', join: 'subtract' })
        Model.addLight(d, 'lcut', { id: 'lcsg', shape: 'disc' })
        Model.setCopies(d, 'lrow', Model.copiesRow(3, 0.5, 'x'))
        Model.setCopies(d, 'lring', Model.copiesRing(4, 2, 'z'))
        return [generate(...Model.generateArgs(d, { id: 'builder-light-arrays', title: 'builder: lights in arrays' })),
                generate(...Model.generateArgs({ ...d, liveVisibility: true }, { id: 'builder-light-arrays-live', title: 'builder: lights in arrays, live' })),
                generate(...Model.generateArgs(d, { id: 'data-builder-light-arrays', title: 'builder: lights in arrays, as data', data: true }))]
    })(),
    /* AND GROUP CODE AS DATA (codegen isBefore, isAfter): its code a function the evaluator calls, its children records
       -- with a material's relief in the scene, so XF_K rides on the base-frame stack (no bundled scene has both), an
       object wearing it under a twist (a compiled subtree under a warp), an array inside a twist, a mirror inside an
       array, a bend as a CSG group's subtracted shape; a shell over a CSG group, a round in an array with a relief in
       it. localDoc reads p_local, which keeps group code compiled: not that one. */
    ...(() => {
        const d = Model.createDoc()
        const rough = Model.addMaterial(d, { id: 'rough' })
        Model.setRelief(d, rough.id, 'noise')
        Model.addGroup(d, 'root', { id: 'btw', ...modifierGroup('twist') })
        Model.addObject(d, 'btw', { primitive: 'box' })
        Model.addObject(d, 'btw', { primitive: 'sphere', material: rough.id })
        Model.addGroup(d, 'btw', { id: 'brow' })
        Model.addObject(d, 'brow', { primitive: 'sphere' })
        Model.setCopies(d, 'brow', Model.copiesRow(3, 1))
        Model.addGroup(d, 'root', { id: 'barr' })
        Model.addGroup(d, 'barr', { id: 'bmir', ...modifierGroup('mirror') })
        Model.addObject(d, 'bmir', { primitive: 'box' })
        Model.setCopies(d, 'barr', Model.copiesRow(2, 3, 'y'))
        const cut = Model.addGroup(d, 'root', { id: 'bcut', blend: 0.05 })
        Model.addObject(d, cut.id, { primitive: 'box' })
        Model.addGroup(d, cut.id, { id: 'bbend', ...modifierGroup('bend'), join: 'subtract' })
        Model.addObject(d, 'bbend', { primitive: 'cylinder' })
        Model.addGroup(d, 'root', { id: 'brep', ...modifierGroup('repeat') })
        Model.addObject(d, 'brep', { primitive: 'sphere', material: rough.id })
        Model.addGroup(d, 'root', { id: 'bsh', ...modifierGroup('shell') })
        const lens = Model.addGroup(d, 'bsh', { id: 'blens', blend: 0.1 })
        Model.addObject(d, lens.id, { primitive: 'cylinder' })
        Model.addObject(d, lens.id, { primitive: 'sphere', join: 'subtract' })
        Model.addGroup(d, 'barr', { id: 'brd', ...modifierGroup('round') })
        Model.addObject(d, 'brd', { primitive: 'box', material: rough.id })
        /* a first parameter called `o`, on a before group, an after group and an object: the data functions' slot offset
           was called that, and the parameters declared after it read their slots through its value instead */
        Model.addGroup(d, 'root', { id: 'bog', code: 'p = p / (1.0 + o * k);\nwarp(1.0 / (1.0 + o * k));\nC = children(C, p);', params: { o: 0.1, k: 0.5 } })
        Model.addObject(d, 'bog', { code: 'C = add_new(C, sdBox(p, VEC3(o + k)), MATERIAL);', params: { o: 0.25, k: 0.1 } })
        Model.addGroup(d, 'root', { id: 'boa', code: 'var H = children(emptyHit(r), p);\nH.s.w -= (o + k) * XF_S;\nC = fold(C, H.s, H.m);', params: { o: 0.01, k: 0.02 } })
        Model.addObject(d, 'boa', { primitive: 'sphere' })
        /* every closed-form shape and the outlines, and a hard CSG group of them (they were here for exact hits, which went
           in 0.41.0: every primitive's code, codegen's and as data, is still worth building) */
        for (const primitive of ['lens', 'capsule', 'disc', 'rectangle', 'plane', 'tube', 'cone', 'dome', 'reflector', 'octahedron', 'pyramid', 'prism', 'round cone', 'fresnel lens', 'revolution', 'extrusion']) Model.addObject(d, 'root', { primitive })
        Model.addGroup(d, 'root', { id: 'bhard' })
        Model.addObject(d, 'bhard', { primitive: 'lens' })
        Model.addObject(d, 'bhard', { primitive: 'cylinder', join: 'subtract' })
        return [generate(...Model.generateArgs(d, { id: 'builder-befores', title: 'builder: before groups' })),
                /* AND A BOX ON EVERY NODE (codegen cull 'all', the bench's alone since 0.34.0: Tests > boxcost): the row above
                   is the builder's way, boxes on the dear nodes only -- on this scene of every shape at the top level,
                   reliefs and groups, some nodes tested and some not -- and this one every top-level node tested */
                generate(...Model.generateArgs(d, { id: 'builder-befores-all', title: 'builder: before groups, a box on every node', cull: 'all' })),
                generate(...Model.generateArgs(d, { id: 'data-builder-befores', title: 'builder: before groups, as data', data: true }))]
    })()]
const { TOKENS, SHORT_TOKENS, shorthand } = await import(pathToFileURL(join(repo, 'lib/wgsl_shorthand.js')).href)
const rewrite = shorthand(TOKENS, SHORT_TOKENS)

/** A device that compiles nothing and remembers everything.
 *  makeFrag too, since the units change: the display pass was the one shader nothing here
 *  compiled, and the exposure and the sRGB encoding moved into it. Recorded with `frag` set and
 *  a `main` that calls the frag function, so the checks below walk it like a compute entry, and
 *  pass four turns it back into tinywebgpu's fullscreen wrapper. */
const spy = {
    makeCompute: (body, main, uniformTypes = {}, resources = {}, opts = {}) =>
        ({ body, main, uniformTypes, resources, opts }),
    makeFrag: (frag, uniformTypes = {}, resources = {}, opts = {}) =>
        ({ body: frag, main: '_ = frag(vec2<f32>(0.5));', frag: true, uniformTypes, resources, opts }),
    /* makeDraw: complete vertex + fragment WGSL, compiled as written (only the schema goes in
       front); reachability starts at the vertex stage, which is what reads the resources */
    makeDraw: opts => ({ body: opts.code, main: '_ = vs_main(0u, 0u);', draw: true,
                         uniformTypes: opts.uniforms || {}, resources: opts.resources || {},
                         opts: { readOnly: opts.readOnly || [] } }),
}
const R2S = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/rendertoscreen.js')).href)
const AE = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/autoexposure.js')).href)
const MF = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/microfacet.js')).href)
const OPT = await import(pathToFileURL(join(repo, 'lib/pathtracer/optics/kernels.js')).href)
const OPTP = await import(pathToFileURL(join(repo, 'lib/pathtracer/optics/paths.js')).href)

const KERNELS = (scene, dev = spy) => [
    ['prep_march_indirect', () => W.prog_prep_march_indirect(dev, 64)],
    ['prep_shade_indirect', () => W.prog_prep_shade_indirect(dev, 64)],
    ['prep_occlude_indirect', () => W.prog_prep_occlude_indirect(dev, 64)],
    ['flip', () => W.prog_flip(dev)],
    // the last pass's extra occlusion rounds (raytrace_main.js THE LAST PASS'S SHADOW ROUNDS)
    ['shadow_flip', () => W.prog_shadow_flip(dev)],
    // the benchmark's wavefront log (R.wavefrontLog): built only when a measurement asks for it
    ['wf_snap', () => W.prog_wf_snap(dev)],
    ['resolve', () => W.prog_resolve(dev, 64, scene)],
    ['march', () => W.prog_march(dev, scene, 64)],
    ['surface', () => W.prog_surface(dev, scene, 64)],
    ['shade', () => W.prog_shade(dev, scene, 64)],
    // the photon map's store and gather (core/sppm.js; 0.60.0): a kernel option, built only while the setting is on
    ['sppm', () => W.prog_sppm(dev, scene, 64)],
    ['occlude', () => W.prog_occlude(dev, scene, 64)],
    /* ...WITH THE STEP CACHE COMPILED IN (wavefront.js stepCacheWGSL; 0.29.0: a kernel option, built only when the setting
       is on, so nothing else here would build it): the cells two ahead, which holds all of 1's code */
    ['march_stepcache', () => W.prog_march(dev, scene, 64, { stepCache: 2 })],
    ['occlude_stepcache', () => W.prog_occlude(dev, scene, 64, { stepCache: 2 })],
    /* ...WITH THE HAZE COMPILED IN (core/haze.js; 0.62.0): built only for a scene with a haze box, so against every other
       scene only here -- the collision in the march (0.62.2: drawn as a leg starts), the vertex, the shadow rays' haze and
       a new leg's tmax in shade, an emitter ray's in the occlusion kernel, with the step cache too */
    ['march_haze', () => W.prog_march(dev, scene, 64, { haze: 1 })],
    ['march_haze_stepcache', () => W.prog_march(dev, scene, 64, { stepCache: 2, haze: 1 })],
    ['shade_haze', () => W.prog_shade(dev, scene, 64, { haze: 1 })],
    ['occlude_haze', () => W.prog_occlude(dev, scene, 64, { haze: 1 })],
    ['occlude_haze_stepcache', () => W.prog_occlude(dev, scene, 64, { stepCache: 2, haze: 1 })],
    /* ...ON DISTANCE ONLY (scene_api.js FOLD_DIST; 0.79.0): the renderer's march, always -- `march` above is the Optics
       page's, the full one -- alone and with the step cache and the haze; `surface` asks for the whole hit itself */
    ['march_dist', () => W.prog_march(dev, scene, 64, { distOnly: 1 })],
    ['march_dist_stepcache_haze', () => W.prog_march(dev, scene, 64, { distOnly: 1, stepCache: 2, haze: 1 })],
    /* ...SHADOW RAYS ON DISTANCE ONLY (0.79.0): the renderer's occlusion kernel, always -- `occlude` above is the full
       one, the GPU tests' reference -- alone and with the step cache and the haze, the resolve of the emitter rays it
       hands on, with and without the haze, and the prep that sizes that resolve */
    ['occlude_dist', () => W.prog_occlude(dev, scene, 64, { distOnly: 1 })],
    ['occlude_dist_stepcache_haze', () => W.prog_occlude(dev, scene, 64, { distOnly: 1, stepCache: 2, haze: 1 })],
    ['occlude_emit', () => W.prog_occlude_emit(dev, scene, 64)],
    ['occlude_emit_haze', () => W.prog_occlude_emit(dev, scene, 64, { haze: 1 })],
    ['prep_occlude_emit', () => W.prog_prep_occlude_indirect(dev, 64, { emit: 1 })],
    // ...and the pass that fills its cells before the trace (the march and occlusion only read them since 0.41.0)
    ['stepcache_fill', () => W.prog_stepcache_fill(dev, scene)],
    ['genrays', () => G.genrays_prog(dev, 64, scene)],
    ['genphotons', () => W.prog_genphotons(dev, 64, scene)],
    ['lt_build', () => W.prog_lt_build(dev, scene)],
    ['emit_collect', () => W.prog_emit_collect(dev, scene)],
    ['emit_publish', () => W.prog_emit_publish(dev)],
    ['skynorm', () => W.prog_skynorm(dev)],
    ['render', () => R2S.rendertoscreen_prog(dev)],
    // ...with the step cache's cells drawn over it (stepCacheView): built only with the cache on
    ['render_cacheview', () => R2S.rendertoscreen_prog(dev, { cacheView: 1 })],
    // a saved picture's exposure and tone curve, after the render (lib/pathtracer/develop.js): only on a save
    ['develop', () => R2S.develop_prog(dev)],
    // ...and the darkroom's histogram of it (0.79.0): compiled on the first histogram asked for
    ['develop_histogram', () => R2S.develop_histogram_prog(dev)],
    ['ae_histogram', () => AE.prog_ae_histogram(dev)],
    ['ae_update', () => AE.prog_ae_update(dev)],
    ['mf_lut', () => MF.prog_mf_lut(dev)],
    ['mf_lut_avg', () => MF.prog_mf_lut_avg(dev)],
    /* compiled only when someone clicks, so nothing else would ever build it; against a builder
       scene it compiles the tagged copy (pickWgsl), against any other the scene as it is */
    ['pick', () => PK.prog_pick(dev, scene)],
    // the mesh export's (core/field.js): compiled only when someone exports, so only here otherwise
    ['field', () => FD.prog_field(dev, scene)],
    // the builder's bounds (the tagged field): compiled when boxes are first asked for
    ['tagfield', () => FD.prog_tagfield(dev, scene)],
    /* the optics module's two (lib/pathtracer/optics): compiled on the first Run of a trace, so
       again nothing else would build them. The shade compiles the pick copy, like the pick. */
    ['opt_gen', () => OPT.prog_opt_gen(dev, scene)],
    ['opt_shade', () => OPT.prog_opt_shade(dev, scene, 64)],
    // the optics trace's march: the renderer's kernel over the optics copy, limiters included
    // (optics/index.js marchScene)
    ['opt_march', () => W.prog_march(dev, scene.opticsWgsl ? { ...scene, wgsl: scene.opticsWgsl } : scene, 64)],
    ['opt_photons', () => OPT.prog_opt_photons(dev)],     // no scene in it (0.34.2): the same for every scene
    ['opt_paths', () => OPTP.makePathDrawer(dev, null).build()],
    /* THE BUILDER'S PROBE (builder/validate.js), as the builder compiles it before a scene is loaded: the
       body is the prelude and the scene in one text, with no sceneConstantsWGSL between them -- the one
       compile that does not go through it. A scene without a light failed this alone (LIGHT_FACES
       unresolved; the user's console, 2026-10-01) while every kernel above compiled. */
    ...(scene.body && !scene._profileDevice ? [['probe', () => dev.makeCompute(scene.body, PROBE_MAIN,
        computeUniformTypes(scene.uniforms), { probe: 'array<f32>', ...(scene.resources || {}) }, { wg: [1, 1, 1], moduleOnly: true })]] : []),
]

const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

/* SCREAMING_SNAKE ONLY, and that is the point rather than a limitation. A general WGSL symbol
   resolver is a compiler; this is the ONE naming convention every constant in these kernels
   follows, which makes "used but never declared" decidable with a regex and no false positives
   from swizzles, builtins or the shorthand tokens (none of which carry an underscore). */
const SCREAMER = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g
const DECLARES = /\b(?:const|let|var(?:<[^>]*>)?|fn|struct|alias)\s+([A-Za-z_]\w*)/g

/* WGSL'S RESERVED WORDS: "A WGSL module must not contain a reserved word" -- anywhere, as a token, so a local
   named with one is a compile error, and naga (pass four) need not say so. `let shared = ...` in ltConnect reached
   the user's page that way (2026-10-03: "shared is a reserved keyword") with passes one to three clean. The list
   is the spec's own, W3C TR WGSL section 16.2, copied 2026-10-03; WGSL has no strings, so outside a comment
   every such token is one. */
const RESERVED = new Set(`NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become
    cast catch class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast
    consteval constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit
    export extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl
    implements import inline instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut
    mutable namespace new nil noexcept noinline nointerpolation non_coherent noncoherent noperspective null nullptr of
    operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public
    readonly ref regardless register reinterpret_cast require resource restrict self set shared sizeof smooth snorm static
    static_assert static_cast std subroutine super target template this thread_local throw trait try type typedef typeid
    typename typeof union unless unorm unsafe unsized use using varying virtual volatile wgsl where with writeonly
    yield`.split(/\s+/))

/* The spec's floor. Requesting the adapter's own higher limit is safe and tinywebgpu does it,
   but a kernel past eight will not run on an adapter that only offers eight. */
const STORAGE_FLOOR = 8, STORAGE_CEILING = 16
/* ...and the uniform buffers' (maxUniformBuffersPerShaderStage), UB counted: every adapter allows 12. A resource typed
   `uniform ` (tinywebgpu) is one of these, not a storage binding -- the scene as data's records' copy, since 0.22.19,
   was the first, and this count took every resource for a storage buffer until then. */
const UNIFORM_FLOOR = 12

const built = []          // [scene, kernel name, recorded build] -- pass four compiles these
let kbad = 0, kwarn = 0, kn = 0

/* THE UNIT LINT (core/unitlint.js, 0.36.0): the engine meets the scene only at the boundary (scene_api.js
   SCENE_BOUNDARY). Its sides by where they are written: these snippets and each scene's own texts are the scene's. */
const UL = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/unitlint.js')).href)
const SA = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/scene_api.js')).href)
const TB = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/tracebasics.js')).href)
const { NOISE: NOISE_WGSL } = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/noise.js')).href)
const { MATERIALS: MATERIALS_WGSL } = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/materials.js')).href)
const { sceneConstantsWGSL } = await import(pathToFileURL(join(repo, 'lib/pathtracer/core/uniforms.schema.js')).href)
const unitSides = scene => ({
    sceneSide: [NOISE_WGSL, MATERIALS_WGSL, SA.SCENE_API, SA.LOCAL_POINT_LOOKED, SA.LOCAL_POINT_GIVEN, TB.SCENE_UNITS_WGSL, sceneConstantsWGSL(scene)],
    boundary: [SA.SCENE_BOUNDARY, SA.SCENE_BOUNDARY_GIVEN],
})
let unitBad = 0
{
    /* ...and every field of the Ray and the Hit sorted into a length (the boundary converts it) or not: a field added
       to either fails this until it is put in one */
    const ray = UL.structFields(TB.DEFINITIONS, 'Ray'), hit = UL.structFields(TB.DEFINITIONS, 'Hit')
    const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
    if (!ray || !same(ray, [...SA.RAY_LENGTHS, ...SA.RAY_NOT_LENGTHS])) {
        unitBad++; console.log(`UNIT  struct Ray's fields ${JSON.stringify(ray)} are not RAY_LENGTHS + RAY_NOT_LENGTHS (scene_api.js): sort the new one`)
    }
    const base = f => f.split('.')[0]
    if (!hit || !same(hit, [...new Set([...SA.HIT_LENGTHS, ...SA.HIT_NOT_LENGTHS].map(base))])) {
        unitBad++; console.log(`UNIT  struct Hit's fields ${JSON.stringify(hit)} are not HIT_LENGTHS + HIT_NOT_LENGTHS (scene_api.js): sort the new one`)
    }
}
for (const scene of CHECKED_SCENES) {
    for (const [name, build] of KERNELS(scene, scene._profileDevice ? PROF.profileWG(spy, 4242) : spy)) {
        kn++
        let k
        try { k = await build() }
        catch (e) { kbad++; console.log(`BUILD THREW  ${scene.id}/${name}: ${e.message}`); continue }
        built.push([scene, name, k])
        for (const line of UL.unitLint(k, scene, name, unitSides(scene))) { unitBad++; if (unitBad <= 40) console.log(`UNIT  ${scene.id}/${line}`) }
        /* the benchmark's uncached device must reach EVERY compute kernel: it wraps makeCompute only, so a kernel
           built another way (a helper inside tinywebgpu calls its own makeCompute, not the wrapper's) would be
           compiled with its live text and could come back from the cache, timed as if it were compiled. And
           async, or its `ready` resolves before it is compiled and the timing leaves it out. */
        if (scene._profileDevice && !k.frag && !k.draw && (!k.main.startsWith(PROF.guardLine(4242)) || k.opts?.async !== true)) {
            kbad++
            console.log(`NOT UNCACHED  ${scene.id}/${name}: its entry point does not start with the benchmark's guard, or it is not async`)
        }

        /* ---- a barrier only in uniform control flow. WGSL requires every invocation of a workgroup to reach a
           barrier together, and naga does not check it: the benchmark's first guard, `if (gid.x == N) { return; }`
           in front of lt_build's barriers, compiled clean in pass four and Tint refused it on the user's machine
           (2026-09-29). This catches that shape only -- in main, before its first barrier, a return inside an if
           whose condition names gid or lid (wid and num_workgroups are uniform, those are not) -- not a return on a
           value derived from them. Every kernel it passes today compiles in Tint. */
        if (!k.frag && !k.draw) {
            const all = stripComments(`${k.body}\n${k.main}`), m = stripComments(k.main)
            const B = /\b(workgroupBarrier|storageBarrier|workgroupUniformLoad|textureBarrier)\s*\(/
            if (B.test(all)) {
                const first = m.search(B), before = first < 0 ? m : m.slice(0, first)
                for (const [, cond, block] of before.matchAll(/\bif\s*\(([^{]*)\)\s*\{([^{}]*)\}/g)) {
                    if (/\b(gid|lid)\b/.test(cond) && /\breturn\b/.test(block)) {
                        kbad++
                        console.log(`NON-UNIFORM BARRIER  ${scene.id}/${name}: \`if (${cond.trim()}) { return }\` before a barrier -- every invocation must reach it (test wid, not gid)`)
                    }
                }
            }
        }

        // ---- every identifier the kernel names must exist somewhere in what it compiles
        const src = stripComments(rewrite(`${k.body}\n${k.main}`))
        const declared = new Set(Object.keys(k.resources))
        for (const m of src.matchAll(DECLARES)) declared.add(m[1])
        const missing = [...new Set(src.match(SCREAMER) || [])].filter(x => !declared.has(x))
        if (missing.length) {
            kbad++
            console.log(`UNRESOLVED   ${scene.id}/${name}: ${missing.join(', ')}`)
            console.log('             nothing in this kernel\'s source declares these -- a missing'
                      + ' prelude, or a constant that moved')
        }
        // ---- and no reserved word in it: the names tinywebgpu writes in (uniforms, resources) too
        const reserved = [...new Set([...(src.match(/\b[A-Za-z_]\w*\b/g) || []), ...Object.keys(k.resources),
                                      ...Object.keys(k.uniformTypes || {})])].filter(x => RESERVED.has(x))
        if (reserved.length) {
            kbad++
            console.log(`RESERVED     ${scene.id}/${name}: ${reserved.join(', ')} -- a WGSL reserved word, which no module may contain`)
        }

        /* ---- every binding tinywebgpu will emit must be REACHABLE from the entry point.
           tinywebgpu decides what to declare by searching the text; the pipeline, built with
           layout:'auto', keeps only what main can actually reach. A name that appears only in
           a helper nothing calls is declared, bound -- and missing from the layout, so the
           bind group is invalid and the whole frame's command buffer with it. prog_lt_build
           shipped that way: DEFINITIONS carries marchEps, which names UB, and nothing in that
           kernel calls it. It dispatches only with light tracing on, so it surfaced as the
           first frame with lt=1 failing -- nothing earlier could see it. */
        {
            const full = stripComments(rewrite(`${k.body}\nfn __entry__() {\n${k.main}\n}`))
            const fns = new Map()
            for (const m of full.matchAll(/\bfn\s+([A-Za-z_]\w*)\s*\(/g)) {
                let i = full.indexOf('{', m.index), depth = 0, j = i
                for (; j < full.length; j++) {
                    if (full[j] === '{') depth++
                    else if (full[j] === '}' && --depth === 0) break
                }
                fns.set(m[1], full.slice(i, j + 1))
            }
            const reach = new Set(['__entry__']), todo = ['__entry__']
            while (todo.length) {
                const f = fns.get(todo.pop()) || ''
                for (const m of f.matchAll(/\b([A-Za-z_]\w*)\s*\(/g))
                    if (fns.has(m[1]) && !reach.has(m[1])) { reach.add(m[1]); todo.push(m[1]) }
            }
            const reachable = [...reach].map(n => fns.get(n)).join('\n')
            const names = [...Object.keys(k.resources), ...(Object.keys(k.uniformTypes || {}).length ? ['UB'] : [])]
            const orphan = names.filter(n => {
                const re = new RegExp(`\\b${n}\\b`)
                return re.test(full) && !re.test(reachable)
            })
            /* ...except the builder's probe, which is a module and never bound (validate.js: makeCompute's
               moduleOnly, its messages, no pipeline, nothing dispatched): tinywebgpu builds a bind group only when resources are bound
               (rebindResources), so a binding the probe does not reach is never in one. An empty scene's SDF
               reads no uniform at all. */
            if (orphan.length && name !== 'probe') {
                kbad++
                console.log(`UNREACHABLE  ${scene.id}/${name}: ${orphan.join(', ')} named in the source but not`
                          + ' reachable from main -- declared by tinywebgpu, dropped by layout:auto,'
                          + ' so the bind group is invalid')
            }
        }

        // ---- and it must fit in a bind group
        const types = Object.values(k.resources).map(String)
        const isUniform = t => /^uniform\s+/.test(t), isStorage = t => !isUniform(t) && !/^(texture_|sampler)/.test(t)
        const nStorage = types.filter(isStorage).length
        const nUniform = types.filter(isUniform).length + (Object.keys(k.uniformTypes || {}).length ? 1 : 0)
        if (nUniform > UNIFORM_FLOOR) {
            kbad++
            console.log(`TOO MANY UNIFORM BUFFERS  ${scene.id}/${name}: ${nUniform}, past ${UNIFORM_FLOOR} that every adapter allows`)
        }
        if (nStorage > STORAGE_CEILING) {
            kbad++
            console.log(`TOO MANY BUFFERS  ${scene.id}/${name}: ${nStorage} storage bindings,`
                      + ` past ${STORAGE_CEILING} that common adapters allow`)
        } else if (nStorage > STORAGE_FLOOR) {
            kwarn++
            console.log(`  note  ${scene.id}/${name}: ${nStorage} storage bindings -- over the`
                      + ` spec floor of ${STORAGE_FLOOR}, so it needs an adapter that offers more`)
        }
    }
}
/* ---- THE FOUR KERNELS THAT NEVER SEE THE SCENE, ONE TEXT ACROSS EVERY SCENE. genrays, resolve, genphotons and
   emit_collect declare the base uniforms only (genrays.js says why), so a scene change finds them in tinywebgpu's
   pipeline cache rather than compiling them again. They used to declare the scene's own uniforms, which made a text
   of each for every scene with uniforms of its own, for a uniform none of them reads -- and that is the regression this
   catches: anything of the scene's creeping back into one of them. Everything tinywebgpu composes the text from is
   compared (body, entry point, uniforms, resources, options). Not the benchmark's uncached device, whose guard line
   is meant to make every text its own. */
{
    const texts = new Map()
    for (const [scene, name, k] of built) {
        if (scene._profileDevice || !['genrays', 'resolve', 'genphotons', 'emit_collect'].includes(name)) continue
        const t = JSON.stringify([k.body, k.main, k.uniformTypes, k.resources, k.opts])
        if (!texts.has(name)) texts.set(name, new Map())
        if (!texts.get(name).has(t)) texts.get(name).set(t, scene.id)
    }
    for (const [name, seen] of texts) if (seen.size !== 1) {
        kbad++
        const first = [...seen.values()]
        console.log(`SCENE IN A SCENE-FREE KERNEL  ${name}: ${seen.size} different texts across the scenes (${first.slice(0, 4).join(', ')}${first.length > 4 ? ', ...' : ''})`
                  + ' -- it must not depend on the scene, or a scene change compiles it again')
    }
    if (texts.size !== 4) { kbad++; console.log(`SCENE-FREE KERNELS  ${texts.size} of the four built: ${[...texts.keys()].join(', ')}`) }
}
if (unitBad) { kbad += unitBad; console.log(`${unitBad} unit lint problem(s): the engine reaching the scene's side but at the boundary (core/unitlint.js)`) }
console.log(kbad ? `\n${kbad} kernel problem(s) across ${kn} builds.`
                 : `${kn} kernel builds check out${kwarn ? ` (${kwarn} note(s) above)` : ''}.`)

/* ==================================================================================================
   PASS THREE: the mistakes that are always mistakes, over lib/pathtracer.

   OPTIONAL, AND LOUD ABOUT IT. eslint is not a dependency of this repo and there is no
   package.json to make it one, so a machine without it gets a line saying the pass did not run
   rather than a silent pass -- a check you believe ran and did not is worse than no check.
================================================================================================== */
const LINT_TARGET = 'lib/pathtracer'
/* ON WINDOWS npx IS npx.cmd, and node will not spawn a .cmd without a shell (ENOENT, or EINVAL since node's
   batch-file fix): the pass said SKIPPED on a machine that may have had eslint. So it goes through the shell
   there, each argument quoted, since the shell splits them. */
const WIN = process.platform === 'win32'
const lintArgs = ['--no-install', 'eslint', '--no-config-lookup',
    '-c', join(repo, 'lib/pathtracer/core/lint.config.mjs'), join(repo, LINT_TARGET)]
const lint = spawnSync('npx', WIN ? lintArgs.map(a => `"${a}"`) : lintArgs, { cwd: repo, encoding: 'utf8', shell: WIN })

let lbad = 0
if (lint.error || lint.status === null) {
    console.log(`\n(lint pass SKIPPED: could not run eslint -- ${lint.error?.message || 'no exit status'})`)
} else if (/command not found|could not determine executable|npm ERR/i.test(lint.stderr || '')) {
    console.log(`\n(lint pass SKIPPED: eslint is not installed. npm i -g eslint to get it.)`)
} else if (lint.status !== 0) {
    lbad = 1
    console.log(`\n${LINT_TARGET} fails the always-a-bug rules:`)
    console.log((lint.stdout || lint.stderr).trim())
} else {
    console.log(`${LINT_TARGET} passes the always-a-bug rules.`)
}

/* ==================================================================================================
   PASS FOUR: compile every kernel with a real WGSL compiler, if one is installed.

   The passes above read the source; none of them can see a TYPE. A mat4 indexed as a vec4, a u32
   added to an f32, a function called with the wrong argument -- all of it parses, all of it
   builds here, and the first thing to say otherwise was the user's browser. naga is the WGSL
   front end wgpu uses; its CLI validates a .wgsl file with no GPU at all:

       cargo install naga-cli          # then either have naga on PATH, or NAGA=/path/to/naga

   THE SOURCE IS REBUILT THE WAY TINYWEBGPU BUILDS IT, because that is what the driver sees:
   makeCompute wraps body and main in an entry point and trims it (tinywebgpu.js makeCompute),
   makePipeline keeps only the resources the code mentions and prepends the schema it generates
   (makePipeline, `usedResources` / `usesUB`), and G.defines is expanded over the whole thing.
   The schema comes from tinywebgpu's own makeSchema -- not a second implementation of it.
   The wrapper and the filter are mirrored by hand, so if either changes in tinywebgpu, change
   it here too; the first symptom would be every kernel failing at once, not a quiet pass.

   OPTIONAL AND LOUD, like pass three: without naga it says the pass did not run.
   naga is not the browser's compiler (Tint), so a clean pass is strong evidence, not proof --
   the page is still the only judge of whether anything renders.
================================================================================================== */
const NAGA = process.env.NAGA || 'naga'
let nbad = 0
const probe = spawnSync(NAGA, ['--version'], { encoding: 'utf8' })
if (probe.error || probe.status !== 0) {
    console.log(`\n(naga pass SKIPPED: no naga at '${NAGA}'. cargo install naga-cli, or set NAGA=...)`)
} else {
    const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'naga-'))
    const TW = WEBGPU()
    TW.createUniformBuffer = () => ({})        // makeSchema allocates one; nothing is drawn here
    for (const [scene, name, k] of built) {
        let wg = k.opts?.wg || [8, 8, 1]
        wg = [wg[0] ?? 1, wg[1] ?? 1, wg[2] ?? 1]
        // tinywebgpu's makeFrag wrapper, mirrored by hand like the compute one below
        const code = k.draw ? k.body.trim() : k.frag ? `struct VSOut {@builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>};
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VSOut {
var ndc = array<vec2<f32>,3>(vec2<f32>(-1.,-3.),vec2<f32>(-1.,1.),vec2<f32>(3.,1.))[i];
var o: VSOut; o.pos = vec4<f32>(ndc, 0.0, 1.0); o.uv = ndc * 0.5 + vec2<f32>(0.5); return o;
}
${k.body}
@fragment fn fs_main(vs: VSOut) -> @location(0) vec4<f32> { return frag(vs.uv); }
`.trim() : `${k.body}
@compute @workgroup_size(${wg})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
${k.main}
}
`.trim()
        const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
        const refd = n => new RegExp(`\\b${n}\\b`).test(bare)
        const used = Object.fromEntries(Object.entries(k.resources || {}).filter(([n]) => refd(n)))
        const schema = TW.makeSchema(refd('UB') ? k.uniformTypes : {}, used,
            { group: 0, startBinding: 0, readOnly: k.opts?.readOnly || [] })
        const file = join(dir, `${scene.id}_${name}.wgsl`)
        writeFileSync(file, rewrite(schema.wgsl ? `${schema.wgsl}\n${code}` : code))
        const r = spawnSync(NAGA, [file], { encoding: 'utf8' })
        if (r.status !== 0) {
            nbad++
            const msg = (r.stderr || r.stdout || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(0, 14).join('\n      ')
            console.log(`WGSL INVALID  ${scene.id}/${name}  (source kept: ${file})\n      ${msg}`)
        }
    }
    console.log(nbad ? `\n${nbad} of ${built.length} kernels fail naga.`
                     : `${built.length} kernels compile under naga.`)
    if (!nbad) rmSync(dir, { recursive: true, force: true })
}

process.exit(kbad || lbad || nbad ? 1 : 0)
