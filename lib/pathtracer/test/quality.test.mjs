// node lib/pathtracer/test/quality.test.mjs
//
// THE QUALITY PRESETS, THE DEVELOPER SETTINGS AND WHAT THE KERNELS ARE GIVEN (quality.js), without a GPU.
// effective() is the one place the view's overrides are decided -- Draft's light sample, Sketch's no
// light, lamps only's black environment, the measuring views in full -- and every one of them is a mode
// nothing else would run here: "a feature behind a flag that nothing exercises is code that has never
// run" (CLAUDE.md). And the Renderer panel's boxes (settingsui.js RENDERER_BOXES): every setting in exactly one.

import { QUALITY_PRESETS, QUALITY_GROUPS, CUSTOM, presetOf, presetValues, applyPreset, devKeys, devChanged, devDefaults, effective, describe, MODE,
         MOVE_NAMES, moveModeOf } from '../quality.js'
import { RENDERER_BOXES } from '../settingsui.js'
import { UniformGroups, UniformSpec, DERIVED } from '../core/uniforms.schema.js'
import { derive, SKETCH_FALLBACK_LX, OPTICS_FLAT_OFF, opticsFlatShare } from '../core/photometry.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '  ' + extra : ''}`) }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)

const defaults = () => Object.fromEntries(Object.entries(UniformSpec).map(([k, s]) => [k, structuredClone(s.def)]))

//----------------------------------------------------------------------------------------------
// The presets
//----------------------------------------------------------------------------------------------
{
    eq('fastest first, then the Optics view', QUALITY_PRESETS.map(p => p.id), ['sketch', 'draft', 'standard', 'high', 'optics'])
    eq('a fresh renderer is Standard', presetOf(defaults()), 'standard')
    for (const p of QUALITY_PRESETS) {
        const v = { ...defaults(), ...presetValues(p.id) }
        eq(`${p.id}: applied, it reads as itself`, presetOf(v), p.id)
        for (const k of Object.keys(p.values)) ok(`${p.id}: sets ${k}, a real setting`, k in UniformSpec)
    }
    const high = { ...defaults(), ...presetValues('high') }
    eq('High quality: more bounces, more photons, full paths', [high.maxbounce, high.ltPhotons, high.renderMode], [24, 2, 0])
    eq('a full picture moved off a preset is Custom', presetOf({ ...defaults(), maxbounce: 12 }), CUSTOM)
    eq('...and Draft from there keeps the rest (the toolbar goes back to it)',
        { ...defaults(), maxbounce: 12, ...presetValues('draft') }.maxbounce, 12)
    eq('Draft is told by the mode alone', presetOf({ ...defaults(), maxbounce: 3, renderMode: 1 }), 'draft')
    eq('...and so is Optics', presetOf({ ...defaults(), maxbounce: 3, ltPhotons: 3, renderMode: 3 }), 'optics')
    eq('Optics keeps the rest (the toolbar goes back to it)', { ...defaults(), ltPhotons: 3, ...presetValues('optics') }.ltPhotons, 3)
    eq('Custom sets nothing (Tweakpane writes the shown value back: it must be a no-op)', presetValues(CUSTOM), {})
    eq('an unknown id sets nothing', presetValues('ultra'), {})
    const p = presetValues('standard'); p.maxbounce = 99
    eq('presetValues is a copy', presetValues('standard').maxbounce, UniformGroups.Tracing.maxbounce.def)
    // the two light tracing switches: either off is less than the full picture, and Standard puts both back
    eq('Standard names both light tracing switches', [presetValues('standard').lt, presetValues('standard').lightRays], [1, 1])
    eq('...so the lights\' rays off is Custom', presetOf({ ...defaults(), lightRays: 0 }), CUSTOM)
    eq('...and High quality keeps them on', presetValues('high').lightRays, 1)
    eq('lamps only is no quality of its own', presetOf({ ...defaults(), lampsOnly: 1 }), 'standard')
    /* DISPERSION (0.74.0), stored the other way round (0 = on): off is less than the full picture, as the light tracing
       switches are, so Standard and High name it and put it back; Draft, Sketch and Optics leave it as set */
    eq('Standard and High name dispersion, on', [presetValues('standard').dispersionOff, presetValues('high').dispersionOff], [0, 0])
    eq('...so dispersion off is Custom', presetOf({ ...defaults(), dispersionOff: 1 }), CUSTOM)
    // MAX DIFFUSE BOUNCES (0.75.0): fewer is less than the full picture, so Standard and High name it -- all of them
    eq('Standard and High name the diffuse bounces, all 40', [presetValues('standard').maxDiffuse, presetValues('high').maxDiffuse], [40, 40])
    eq('...so fewer is Custom', presetOf({ ...defaults(), maxDiffuse: 2 }), CUSTOM)
    eq('...and Draft from there is Draft, still off', [presetOf({ ...defaults(), dispersionOff: 1, ...presetValues('draft') }),
        { ...defaults(), dispersionOff: 1, ...presetValues('draft') }.dispersionOff], ['draft', 1])
    eq('the Quality box shows every preset once: Preview, Accurate, Optics',
        QUALITY_GROUPS.flatMap(g => g.presets.map(q => q.id)), ['sketch', 'draft', 'standard', 'high', 'optics'])
}

//----------------------------------------------------------------------------------------------
// The Quality box's line (describe)
//----------------------------------------------------------------------------------------------
{
    for (const q of QUALITY_PRESETS)
        eq(`${q.id}: its help`, describe({ ...defaults(), ...presetValues(q.id) }), { id: q.id, text: q.help, note: '' })
    eq('Custom: what differs from Standard, by label', describe({ ...defaults(), maxbounce: 12 }).text,
        'Your own settings: Max Bounces 12 (Standard: 10).')
    eq('...a switch as on or off', describe({ ...defaults(), lightRays: 0 }).text,
        'Your own settings: Lights\' rays (light objects) off (Standard: on).')
    eq('...against the nearer preset', describe({ ...defaults(), ...presetValues('high'), lt: 0 }).text,
        'Your own settings: Caustics (sun, glowing surfaces) off (High quality: on).')
    eq('...Standard on a tie', describe({ ...defaults(), maxbounce: 17 }).text, 'Your own settings: Max Bounces 17 (Standard: 10).')
    eq('...a choice by its option\'s name: dispersion off', describe({ ...defaults(), dispersionOff: 1 }).text,
        'Your own settings: Dispersion off (every glass at n_d) (Standard: as each glass sets it).')
    eq('...fewer diffuse bounces (0.75.0)', describe({ ...defaults(), maxDiffuse: 2 }).text,
        'Your own settings: Max Diffuse Bounces 2 (Standard: 40).')
    ok('a false-colour view in Draft: the note says it traces in full',
        describe({ ...defaults(), renderMode: 1, measureMode: 2 }).note.includes('traces in full'))
    eq('...and nothing to say in full, or in the photograph', [describe({ ...defaults(), measureMode: 1 }).note,
        describe({ ...defaults(), renderMode: 1 }).note], ['', ''])
}

//----------------------------------------------------------------------------------------------
// The Renderer panel's boxes (settingsui.js RENDERER_BOXES)
//----------------------------------------------------------------------------------------------
{
    const keys = rows => rows.flatMap(r => r && typeof r === 'object' && r.rows ? keys(r.rows) : [typeof r === 'string' ? r : r.key])
    const placed = RENDERER_BOXES.flatMap(b => keys(b.rows ?? []))
    const settings = ['Tracing', 'Advanced'].flatMap(g => Object.entries(UniformGroups[g]).filter(([, sp]) => sp.gui).map(([k]) => k))
    // renderMode is the Quality buttons, not a row
    eq('every renderer setting is in a box, but the mode', settings.filter(k => !placed.includes(k)), ['renderMode'])
    eq('...and in one only', placed.filter((k, i) => placed.indexOf(k) !== i), [])
    eq('...and a box names nothing else', placed.filter(k => !settings.includes(k)), [])
    eq('the boxes, in order', RENDERER_BOXES.map(b => b.title), ['Quality', 'Light sources', 'Paths and noise', 'Render size', 'Ray marching', 'Performance', 'Diagnostics'])
    const lights = keys(RENDERER_BOXES.find(b => b.title === 'Light sources').rows)
    eq('the light sources\' switches first: the environment, the caustics, the lights\' rays', lights.slice(0, 4), ['lampsOnly', 'lt', 'lightRays', 'ltPhotons'])
    for (const b of RENDERER_BOXES.filter(b => b.title === 'Ray marching' || b.title === 'Performance' || b.title === 'Diagnostics'))
        ok(`${b.title}: a developer's alone`, b.dev || keys(b.rows).every(k => UniformSpec[k].gui.dev))
    /* THE PERFORMANCE BOX (0.30.0): every build option in it, a word at its top, a help on every row, and what a row
       needs (gui.requires) a setting of the same box above it -- so the greyed row sits under what turns it on */
    const perf = RENDERER_BOXES.find(b => b.title === 'Performance'), pk = keys(perf.rows)
    eq('Performance: the GPU time a frame, the bake, the scene as data, shadow rays on distance only (0.next), the step cache, its fill, cells and view', pk,
        ['sliceMs', 'sceneBake', 'sceneData', 'alongRay', 'stepCache', 'stepCacheFill', 'stepCacheCells', 'stepCacheView'])
    // the candidate grid's and exact hits' switches are gone (0.41.0), and the cache's fill has no 0 (the lazy fill)
    ok('...and no `sceneGrid` or `sceneExact` anywhere: not a setting, not a row', !('sceneGrid' in UniformSpec) && !('sceneExact' in UniformSpec)
        && !RENDERER_BOXES.some(b => keys(b.rows || []).some(k => k === 'sceneGrid' || k === 'sceneExact')))
    ok('...the step cache\'s fill from 1, filled once by default', UniformSpec.stepCacheFill.def === 1 && UniformSpec.stepCacheFill.gui.min === 1 && UniformSpec.stepCacheFill.gui.max === 2)
    // the bounding boxes' switch is gone (0.34.0): the builder tests a box on the dear nodes only (codegen.js), always
    ok('...and no `cull` anywhere: not a setting, not a row', !('cull' in UniformSpec) && !RENDERER_BOXES.some(b => keys(b.rows || []).includes('cull')))
    /* nor Keep on move, Fast normals or Normal limit (0.74.0; the user: "may be removed", "just remove it"): a restart on
       every move, the SDF's own normal wherever it gives one, and no surface dropped for its normal's direction */
    for (const k of ['moveAverages', 'fastnormals', 'normallimit'])
        ok(`...nor \`${k}\`: not a setting, not a row`, !(k in UniformSpec) && !RENDERER_BOXES.some(b => keys(b.rows || []).includes(k)))
    eq('Paths and noise: the bounces, the diffuse ones, dispersion (ticked is on), the clamp, roulette, the window',
        keys(RENDERER_BOXES.find(b => b.title === 'Paths and noise').rows), ['maxbounce', 'maxDiffuse', 'dispersionOff', 'fireflyClamp', 'rr', 'maxaverages'])
    eq('...dispersion shown the other way round', RENDERER_BOXES.find(b => b.title === 'Paths and noise').rows.find(r => r.key === 'dispersionOff')?.invert, true)
    ok('...its word at the top, and every row\'s help', perf.intro?.length > 40 && pk.every(k => UniformSpec[k].gui.help?.length > 40))
    const req = Object.entries(UniformSpec).filter(([, sp]) => sp.gui?.requires)
    eq('what needs what: the cache\'s fill, cells and view the cache; what a move traces as, fast while moving; the photon map\'s radius and capacity the map',
        Object.fromEntries(req.map(([k, sp]) => [k, sp.gui.requires])),
        { moveMode: ['moveFast'], sppmRadius: ['sppm'], sppmCapacity: ['sppm'], stepCacheFill: ['stepCache'], stepCacheCells: ['stepCache'], stepCacheView: ['stepCache'] })
    const boxOf = k => keys(RENDERER_BOXES.find(b => keys(b.rows ?? []).includes(k))?.rows ?? [])
    ok('...each needed setting in the same box, above the one that needs it', req.every(([k, sp]) => sp.gui.requires.every(r => {
        const bk = boxOf(k)
        return bk.indexOf(r) >= 0 && bk.indexOf(r) < bk.indexOf(k)
    })))
}

//----------------------------------------------------------------------------------------------
// The developer settings
//----------------------------------------------------------------------------------------------
{
    const dev = devKeys()
    // the surface tolerance is no setting since 0.66.0: the scene's (builder model.js setTolerance)
    ok('eps has no control: the scene sets its tolerance', !UniformSpec.eps.gui)
    for (const k of ['maxiter', 'stepscale', 'rr', 'nee', 'ltLearn', 'ltRadius', 'emitRadius', 'neeEmitShare',
                     'ltEmitShare', 'draftSeek', 'maxaverages', 'neeSunPick', 'envUniform'])
        ok(`${k} is a developer setting`, dev.includes(k))
    for (const k of ['renderMode', 'maxbounce', 'maxDiffuse', 'dispersionOff', 'lt', 'lightRays', 'ltPhotons', 'fireflyClamp', 'lampsOnly', 'opticsFlat'])
        ok(`${k} is a user's`, !dev.includes(k) && !!UniformSpec[k].gui)
    eq('every Advanced setting with a control is a developer\'s',
        Object.entries(UniformGroups.Advanced).filter(([, s]) => s.gui && !s.gui.dev).map(([k]) => k), [])
    /* the scene's environment is the builder's (model.js ENVIRONMENT): a developer flag there would hide a
       row of a scene's properties, which is not what the switch is for */
    eq('nothing of the environment is', Object.entries(UniformGroups.Lighting).filter(([, s]) => s.gui?.dev).map(([k]) => k), [])
    eq('at the defaults nothing has changed', devChanged(defaults()), [])
    eq('a moved one is named', devChanged({ ...defaults(), maxiter: 128, stepscale: 0.5, maxbounce: 3 }), ['maxiter', 'stepscale'])
    eq('...and the reset puts it back', devChanged({ ...defaults(), maxiter: 128, ...devDefaults() }), [])
    eq('the reset touches developer settings only', Object.keys(devDefaults()).filter(k => !dev.includes(k)), [])
}

//----------------------------------------------------------------------------------------------
// What the kernels are given
//----------------------------------------------------------------------------------------------
{
    const d = defaults()
    const before = JSON.stringify(d)
    const draft = effective({ ...d, renderMode: 1, nee: 0, lt: 1 })
    eq('Draft: its light sample is on whatever nee says, light tracing as set', [draft.renderMode, draft.nee, draft.lt], [1, 1, 1])
    const sketch = effective({ ...d, renderMode: 2, nee: 1, lt: 1 })
    eq('Sketch: no light sample, no photons', [sketch.renderMode, sketch.nee, sketch.lt], [2, 0, 0])
    eq('Full: as set', [effective({ ...d, nee: 0, lt: 0 }).nee, effective({ ...d, nee: 0, lt: 0 }).lt], [0, 0])
    const optics = effective({ ...d, renderMode: 3, nee: 1, lt: 1 })
    eq('Optics: Sketch\'s camera side -- no light sample, no sun photons', [optics.renderMode, optics.nee, optics.lt], [3, 0, 0])
    for (const m of [1, 2, 3])
        eq(`the measuring views trace in full (renderMode ${m})`, [1, 2].map(mm => effective({ ...d, renderMode: m, measureMode: mm }).renderMode), [0, 0])
    eq('a mode out of range is clamped', [effective({ ...d, renderMode: 7 }).renderMode, effective({ ...d, renderMode: -1 }).renderMode], [3, 0])
    eq('dispersion as set in every mode, moving or not (no mode overrides it)',
        [0, 1, 2, 3].flatMap(m => [0, 1].flatMap(o => [false, true].map(moving => effective({ ...d, renderMode: m, dispersionOff: o }, { moving }).dispersionOff))),
        [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1])
    eq('max diffuse bounces as set in every mode, moving or not: the kernels take it as diffuseCap (photometry.js derive)',
        [0, 1, 2, 3].flatMap(m => [false, true].map(moving => effective({ ...d, renderMode: m, maxDiffuse: 3 }, { moving }).maxDiffuse)),
        [3, 3, 3, 3, 3, 3, 3, 3])
    eq('the settings themselves are not written', JSON.stringify(d), before)

    const lamps = effective({ ...d, lampsOnly: 1, envMode: 1, envUniform: 5 })
    eq('lamps only: no sun, sky, studio or furnace light', [lamps.sunIlluminance, lamps.skyIlluminance, lamps.studioIlluminance, lamps.envUniform], [0, 0, 0, 0])
    eq('...and NEE aims at the lamps', lamps.neeEmitShare, 0.95)
    const L = derive(effective({ ...d, lampsOnly: 1 }), { skyRaw: 1 })
    eq('...which derive turns into a black environment', [L.sunL, L.skyScale, L.neeSunPick], [0, 0, 0])
    ok('...the studio\'s too', derive(effective({ ...d, lampsOnly: 1, envMode: 1 })).studioL.every(c => c === 0))
    eq('...with the sketch light at its fallback', L.sketchE, SKETCH_FALLBACK_LX)
    ok('...and nothing in the bag a kernel does not declare', Object.keys(effective(d)).every(k => k in UniformSpec || k in DERIVED))
    eq('off, the environment is the scene\'s', [effective(d).sunIlluminance, effective(d).neeEmitShare], [d.sunIlluminance, d.neeEmitShare])
    eq('MODE names the four', MODE, { FULL: 0, DRAFT: 1, SKETCH: 2, OPTICS: 3 })
    /* the photon count is the lights' too (optics/index.js perPixel reads ltPhotons whatever lt is): shown in
       Optics, whose picture they are, and with the sun's caustics off */
    eq('Photons per Pixel shows in full, Draft and Optics, whatever lt is', UniformSpec.ltPhotons.gui.showIf, { renderMode: [0, 1, 3] })
    eq('the flat light\'s setting only in Optics', UniformSpec.opticsFlat.gui.showIf, { renderMode: [3] })
    // the lights' rays: wherever the lights' photons can run -- not in Sketch (raytrace_main.js gives none there)
    eq('the lights\' rays\' switch shows in full, Draft and Optics', UniformSpec.lightRays.gui.showIf, { renderMode: [0, 1, 3] })
    eq('...and is in no bag override: raytrace_main.js reads it as set', effective({ ...d, lightRays: 0 }).lightRays, 0)
    eq('...its left end is off', UniformSpec.opticsFlat.gui.min, OPTICS_FLAT_OFF)

    /* WHILE MOVING (0.59.0; the view's ⚡, interaction.js): a full picture traced as moveMode with that mode's own rules,
       the light modes as they are, nothing with moveFast off, the measuring views in full, the settings unwritten */
    const mv = (v, moving = true) => effective({ ...d, ...v }, { moving })
    eq('fast while moving: on by default, as Draft', [d.moveFast, d.moveMode, moveModeOf(d), MOVE_NAMES[moveModeOf(d)]], [1, 1, 1, 'Draft'])
    eq('...Standard moving traces as Draft, its light sample on', [mv({ nee: 0 }).renderMode, mv({ nee: 0 }).nee], [1, 1])
    eq('...as Sketch when asked, no light sample, no photons', [mv({ moveMode: 2 }).renderMode, mv({ moveMode: 2 }).nee, mv({ moveMode: 2 }).lt], [2, 0, 0])
    eq('...High and Custom too', [mv(presetValues('high')).renderMode, mv({ maxbounce: 12 }).renderMode], [1, 1])
    eq('...and a moveMode out of its two is Draft', mv({ moveMode: 3 }).renderMode, 1)
    eq('...Draft, Sketch and Optics stay as they are, whatever moveMode says', [1, 2, 3].map(m => mv({ renderMode: m, moveMode: m === 1 ? 2 : 1 }).renderMode), [1, 2, 3])
    eq('...not moving, full as set', [mv({}, false).renderMode, mv({ moveMode: 2 }, false).renderMode], [0, 0])
    eq('...fast while moving off: full while moving', mv({ moveFast: 0 }).renderMode, 0)
    eq('...a measuring view in full, moving or not', [1, 2].map(mm => mv({ measureMode: mm, moveMode: 2 }).renderMode), [0, 0])
    eq('...and the settings are not written: the preset reads as chosen', [presetOf({ ...d }), JSON.stringify(d) === before], ['standard', true])
    eq('...no preset names them: choosing one leaves them as they are', QUALITY_PRESETS.filter(q => 'moveFast' in q.values || 'moveMode' in q.values), [])
}

//----------------------------------------------------------------------------------------------
// A preset chosen (applyPreset): the Quality box's buttons, the view's Quality menu and the menu bar's commands alike
//----------------------------------------------------------------------------------------------
{
    const d = defaults()
    const writes = []
    const set = v => writes.push(v)
    eq('the preset in force writes nothing (no restart)', [applyPreset('standard', d, set), writes.length], [{}, 0])
    eq('Draft from Standard writes the mode alone', applyPreset('draft', d, set), { renderMode: 1 })
    eq('High from Standard writes what differs', applyPreset('high', d, set), { maxbounce: 24, ltPhotons: 2 })
    eq('...each through set, once', writes, [{ renderMode: 1 }, { maxbounce: 24, ltPhotons: 2 }])
    eq('Custom and an unknown id write nothing', [applyPreset(CUSTOM, d, set), applyPreset('ultra', d, set), writes.length], [{}, {}, 2])
    eq('Standard with dispersion off puts it back on', applyPreset('standard', { ...d, dispersionOff: 1 }, set), { dispersionOff: 0 })
    eq('...Draft leaves it off', applyPreset('draft', { ...d, dispersionOff: 1 }, set), { renderMode: 1 })
}

//----------------------------------------------------------------------------------------------
// The sketch light's level (photometry.js derive): what the environment puts on a level surface
//----------------------------------------------------------------------------------------------
{
    const d = defaults()
    const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
    const sunsky = derive({ ...d, uSunElevation: 30 }).sketchE
    ok('sun and sky: E_sun sin h + E_sky', close(sunsky, 100000 * 0.5 + 15000), `${sunsky}`)
    ok('the sun below the horizon: the sky alone', close(derive({ ...d, uSunElevation: -10 }).sketchE, 15000))
    eq('the studio: its setting', derive({ ...d, envMode: 1, studioIlluminance: 800 }).sketchE, 800)
    ok('the furnace: pi L', close(derive({ ...d, envUniform: 1000 }).sketchE, Math.PI * 1000))
    eq('no light at all: the fallback', derive({ ...d, sunIlluminance: 0, skyIlluminance: 0 }).sketchE, SKETCH_FALLBACK_LX)

    /* THE OPTICS VIEW'S FLAT LIGHT: Sketch's level times 2^stops, none at the left end -- read from the bag AS
       TRACED, so a measuring view (mode 0 there) and Sketch are never dimmed by it */
    const lit = v => derive(effective({ ...d, uSunElevation: 30, ...v })).sketchE
    ok('Optics at 0 stops: Sketch\'s level', close(lit({ renderMode: 3, opticsFlat: 0 }), sunsky))
    ok('...2 stops down: a quarter', close(lit({ renderMode: 3, opticsFlat: -2 }), sunsky / 4))
    eq('...at the left end: none', lit({ renderMode: 3, opticsFlat: OPTICS_FLAT_OFF }), 0)
    eq('...and past it, none', lit({ renderMode: 3, opticsFlat: -40 }), 0)
    ok('...never above Sketch\'s', close(lit({ renderMode: 3, opticsFlat: 3 }), sunsky))
    ok('...nothing set: Sketch\'s', close(lit({ renderMode: 3, opticsFlat: undefined }), sunsky))
    ok('Sketch is not dimmed by it', close(lit({ renderMode: 2, opticsFlat: -4 }), sunsky))
    ok('nor a measuring view in the Optics mode', close(lit({ renderMode: 3, opticsFlat: -4, measureMode: 1 }), sunsky))
    ok('lamps only in Optics: the fallback, dimmed', close(lit({ renderMode: 3, opticsFlat: -1, lampsOnly: 1 }), SKETCH_FALLBACK_LX / 2))
    eq('the share, in steps', [0, -1, -12, -13].map(opticsFlatShare), [1, 0.5, 0, 0])
}

console.log(fail ? `\n${fail} failed, ${pass} passed.` : `quality: ${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
