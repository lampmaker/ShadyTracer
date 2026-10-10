// node lib/pathtracer/core/test/tolerances.test.mjs
//
// THE TABLE OF TOLERANCES IS THE SOURCE'S (core/tolerances.js TOLERANCES). Every row says how many times its use appears
// in which file; this counts them, comments out, and fails on any difference -- and on any call of the engine's
// tolerance functions (marchTol, normalTol, offsetTol) that no row accounts for. So a use added, moved or removed fails
// here until the table says so, and the table, the printout (node core/tolerances.js), RT.tolerances() and
// lib/pathtracer/PRECISION.md cannot drift from the code without this saying it. Also: every row is in PRECISION.md.
import { readFileSync } from 'node:fs'
import { TOLERANCES, resolveTolerances, formatLength, marchTolAt, f32Floor } from '../tolerances.js'
// a JS file's comments out, as check-shaders strips them (WGSL's nesting is not JS's: wgslgraph.js's would read a whole
// JS file as one comment from its first unbalanced marker)
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const root = new URL('../../', import.meta.url)            // lib/pathtracer/
const text = new Map()
const src = file => { if (!text.has(file)) text.set(file, stripComments(readFileSync(new URL(file, root), 'utf8'))); return text.get(file) }

for (const t of TOLERANCES) for (const [file, want] of Object.entries(t.sites)) {
    const got = (src(file).match(new RegExp(t.pattern.source, 'g')) || []).length
    ok(`${t.name}: ${want} in ${file.replace('../../', '')}`, got === want, `found ${got}`)
}

/* EVERY CALL OF THE ENGINE'S TOLERANCES IS SOME ROW'S. Not counted: their own definitions and the scene's side of them
   (tracebasics.js EPS_WGSL, tolerances.js MARCH_TOL_WGSL), and the boundary handing the scene its tolerance (SCN_TOL) */
const ENGINE = ['core/wavefront.js', 'core/tracebasics.js', 'core/materials_pbr.js', 'core/pick.js', 'optics/kernels.js', 'core/scene_api.js']
for (const file of ENGINE) {
    const s = src(file), covered = new Set()
    for (const t of TOLERANCES) if (file in t.sites) for (const m of s.matchAll(new RegExp(t.pattern.source, 'g'))) for (let i = m.index; i < m.index + m[0].length; i++) covered.add(i)
    const stray = []
    for (const m of s.matchAll(/\b(marchTol|normalTol|offsetTol)\(/g)) {
        const line = s.slice(s.lastIndexOf('\n', m.index) + 1, s.indexOf('\n', m.index))
        if (/\bfn\s+(marchTol|normalTol|offsetTol|marchEps|normalEps|offsetEps)\b|SCN_TOL\s*=/.test(line)) continue
        if (![...Array(m[0].length).keys()].some(k => covered.has(m.index + k))) stray.push(line.trim().slice(0, 110))
    }
    ok(`${file}: every use of the engine's tolerances is in the table`, stray.length === 0, stray.join('\n      '))
}

// EVERY ROW IN THE DOCUMENT
{
    const doc = readFileSync(new URL('PRECISION.md', root), 'utf8')
    const missing = TOLERANCES.filter(t => !doc.includes(t.name))
    ok('PRECISION.md names every row of the table', missing.length === 0, missing.map(t => t.name).join(', '))
}

// RESOLVED (RT.tolerances): the RGBW mixer's automatic 10.5 um, in mm
{
    const r = resolveTolerances({ eps: 0, epsAuto: 1.054e-5, sceneUnit: 0.001 }, [0.02, 0, 0])
    const row = n => r.rows.find(x => x.name === n)
    ok('resolved: the automatic one at a point 2 cm out, above the floor there', r.setting === 'automatic' && r.tolerance === 1.054e-5 && r.floorHere < r.tolerance)
    ok('...each use in metres and in the scene\'s unit: the step off a surface 105 um, 0.105 mm', Math.abs(row('leaving a surface').metres - 1.054e-4) < 1e-12
        && Math.abs(row('leaving a surface').inSceneUnits - 0.1054) < 1e-9)
    ok('...a fixed length as it is: the longest march 1 km, a million mm', row('longest march').metres === 1000 && Math.abs(row('longest march').inSceneUnits - 1e6) < 1e-6)
    const set = resolveTolerances({ eps: 1e-6, epsAuto: 1.054e-5, sceneUnit: 0.001 }, [1, 0, 0])
    ok('set by hand to 1 um, 1 m out: the floor there, 15 um', set.setting === 'set' && set.tolerance === marchTolAt(1e-6, [1, 0, 0]) && set.tolerance === f32Floor([1, 0, 0]))
    ok('lengths as a person reads them', formatLength(1.054e-5) === '10.5 µm' && formatLength(2.4e-7) === '240 nm' && formatLength(0.0105) === '10.5 mm' && formatLength(400) === '400 m')
}

console.log(`tolerances: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
