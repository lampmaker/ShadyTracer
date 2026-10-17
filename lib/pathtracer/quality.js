//======================================================================================================================
// QUALITY -- the presets a user picks from, which settings are a developer's, and what the kernels are
// actually given.
//
//   presetOf(values)           -> 'sketch' | 'draft' | 'standard' | 'high' | 'optics' | 'custom'
//   presetValues(id)           -> the settings that preset sets, for RT.set
//   devKeys() / devChanged(v)  -> the developer settings (gui.dev), and those not at their default
//   applyPreset(id, values, set) -> a preset chosen: only what differs written, so choosing the one in force restarts nothing
//   effective(values, {moving}) -> the settings with the view's overrides applied: what the kernels get
//   describe(values)           -> the Quality box's line: what the preset traces, or what differs from it
//
// Pure, no GPU, so test/quality.test.mjs runs every line of it. The panel (settingsui.js), the host's
// menu and the uniform bag (index.js buildUniforms) all read it, so they cannot disagree about what
// "Draft", "Optics" or "lamps only" means.
//======================================================================================================================

import { UniformGroups } from './core/uniforms.schema.js'

const T = UniformGroups.Tracing
/* STANDARD IS THE DEFAULTS, read from the schema rather than copied: a default moved there moves the
   preset with it, and a fresh renderer reads "Standard" without anyone keeping two lists in step. */
/* lightRays (0.16.0) with lt: the two light tracing switches, and off either is less than the full picture -- and so is
   dispersion off (0.68.0): "Standard" with every glass at n_d would hide that the fringes are gone */
const STANDARD = Object.fromEntries(['renderMode', 'maxbounce', 'dispersionOff', 'lt', 'lightRays', 'ltPhotons', 'fireflyClamp']
    .map(k => [k, T[k].def]))

/* THE PRESETS, fastest first, and then Optics, which is a way of looking rather than a level of effort.
   A preset sets only what it names: Sketch, Draft and Optics change how far a path goes and leave the
   rest as it was, so choosing Standard or High again goes back to exactly the full picture it left, and the view's
   fast-while-moving switch (effective, `moving`) need not touch the settings at all.
   Standard and High quality name everything that sets the full picture's effort.
   High quality's numbers are a choice, not a measurement: more bounces for long chains through glass,
   twice the photons for caustics. What they cost is the render-modes-cost bench row's to say. */
export const QUALITY_PRESETS = [
    { id: 'sketch', label: 'Sketch (flat light, fastest)', values: { renderMode: 2 },
      help: 'Shapes only: a fixed light, no shadows. Mirrors and glass still show what they reflect and what is behind them.' },
    { id: 'draft', label: 'Draft (direct light)', values: { renderMode: 1 },
      help: 'Light straight from the sun, the sky and the lamps, with shadows; no bounce light. Mirrors and glass are followed.' },
    { id: 'standard', label: 'Standard', values: { ...STANDARD },
      help: `Full path tracing at the default settings: up to ${STANDARD.maxbounce} bounces, caustics and the lights' rays on.` },
    { id: 'high', label: 'High quality', values: { ...STANDARD, maxbounce: 24, ltPhotons: 2 },
      help: 'Full path tracing with up to 24 bounces and twice the photons, for long chains through glass and quieter'
          + ' caustics: slower per sample.' },
    { id: 'optics', label: 'Optics (light rays, flat light)', values: { renderMode: 3 },
      help: 'Sketch\'s flat light, and the lights\' rays traced through lenses, mirrors and glossy reflectors to the'
          + ' first diffuse surface, where they show and stop: no bounce light. Flat light dims the shading.' },
]
export const CUSTOM = 'custom'
/* THE QUALITY BOX'S ORDER (settingsui.js): the user's two ends, "quick preview" and "accurate render" (2026-10-04),
   each a pill of its own, fastest first -- and Optics apart, being a way of looking rather than a level of effort.
   `short` is what its button says; the preset's label and help are its tooltip. */
export const QUALITY_GROUPS = [
    { title: 'Preview', presets: [{ id: 'sketch', short: 'Sketch' }, { id: 'draft', short: 'Draft' }] },
    { title: 'Accurate', presets: [{ id: 'standard', short: 'Standard' }, { id: 'high', short: 'High' }] },
    { title: '', presets: [{ id: 'optics', short: 'Optics' }] },
]

const same = (a, b) => typeof a === 'object' || typeof b === 'object' ? JSON.stringify(a) === JSON.stringify(b) : +a === +b

/** The preset the values are, or 'custom'. Sketch and Draft are told by the mode alone (they set
 *  nothing else); a full picture is Standard or High quality only if every setting either names agrees. */
export function presetOf(values) {
    for (const p of QUALITY_PRESETS)
        if (Object.entries(p.values).every(([k, v]) => same(values?.[k], v))) return p.id
    return CUSTOM
}

/** What a preset sets, as a fresh object for RT.set; {} for 'custom' or an unknown id (a no-op). */
export const presetValues = id => ({ ...(QUALITY_PRESETS.find(p => p.id === id)?.values ?? {}) })

/** A PRESET CHOSEN -- the Quality box's buttons and the view's Quality menu alike (settingsui.js, viewtools.js): only the
 *  values that differ from `values` are handed to `set`, so choosing the preset already in force writes nothing and does
 *  not restart the picture. Returns what was written ({} for 'custom', an unknown id, or nothing to change). */
export function applyPreset(id, values, set) {
    const diff = Object.fromEntries(Object.entries(presetValues(id)).filter(([k, v]) => !same(values?.[k], v)))
    if (Object.keys(diff).length) set(diff)
    return diff
}

/** Every developer setting (gui.dev, uniforms.schema.js), group by group in schema order. */
export const devKeys = (groups = UniformGroups) =>
    Object.values(groups).flatMap(g => Object.entries(g).filter(([, sp]) => sp.gui?.dev).map(([k]) => k))

/** The developer settings whose value is not their default: what a hidden panel would otherwise
 *  hide (a workspace saved by a developer, a value set from the console). */
export function devChanged(values, groups = UniformGroups) {
    const spec = Object.assign({}, ...Object.values(groups))
    return devKeys(groups).filter(k => k in (values || {}) && !same(values[k], spec[k].def))
}

/** The developer settings at their defaults, for RT.set (the panel's Reset button). */
export const devDefaults = (groups = UniformGroups) => {
    const spec = Object.assign({}, ...Object.values(groups))
    return Object.fromEntries(devKeys(groups).map(k => [k, structuredClone(spec[k].def)]))
}

/* THE MODES THE KERNELS GET (materials_pbr.js FAST MODES). */
export const MODE = { FULL: 0, DRAFT: 1, SKETCH: 2, OPTICS: 3 }
/* THE MODES A MOVE MAY TRACE IN (moveMode, uniforms.schema.js), by renderMode: what the view's ⚡ and its menu call them */
export const MOVE_NAMES = { [MODE.DRAFT]: 'Draft', [MODE.SKETCH]: 'Sketch' }
/** The mode a move traces in, from the settings: Draft unless Sketch is asked. */
export const moveModeOf = values => (values?.moveMode | 0) === MODE.SKETCH ? MODE.SKETCH : MODE.DRAFT

/**
 * THE SETTINGS AS TRACED: `values` (every group's, flat) with what the view overrides. A new object;
 * the settings themselves are never written, so the panel, the workspace and the scene keep what the
 * user set.
 *
 * - THE MEASURING VIEWS TRACE IN FULL. Lux on surfaces and luminance are readings, and a reading that
 *   is quietly the direct light only is the worst kind of wrong. So the mode is FULL whenever
 *   measureMode is not 0, whatever renderMode says.
 * - DRAFT needs its light sample (nee 1): it is all the light a stopped path gets. Light tracing is as
 *   set -- it is how light through glass reaches a surface (an LED behind its lens), which Draft's
 *   shadow rays cannot see through.
 * - SKETCH traces no light at all: no light samples, no photons (lt 0; the host also skips the optics
 *   sources' photons, raytrace_main.js).
 * - OPTICS is Sketch's camera side -- the same flat light, no light samples, no sun photons -- with the
 *   lights' photons kept (raytrace_main.js): those are the rays it shows. The sun's would be caustics of
 *   a light this view replaces by the flat one, so lt is 0 here too.
 * - WHILE MOVING (0.59.0; opts.moving, the host's interaction.js: the camera, a drag, a live value): with moveFast on, a
 *   full picture (Standard, High, Custom) traces as moveMode -- Draft or Sketch -- until the move ends, and the rules
 *   below for that mode follow. Draft, Sketch and Optics are light already and stay as they are. The settings are not
 *   written: the panel, the presets and a workspace see the mode the user chose. The measuring views still trace in
 *   full: they are readings, moving or not.
 * - LAMPS ONLY: the sun, the sky, the studio light and the furnace test's uniform light at zero, so
 *   derive() makes the disc, the studio's L0 and the sun's samples 0 and ensureSky the sky's scale.
 *   NEE then spends its samples on the emitters (0.95, the share's ceiling): the environment it would
 *   otherwise aim half of them at is black. Any share is unbiased -- the mixture pdf reads the same number.
 */
export function effective(values, { moving = false } = {}) {
    const v = { ...values }
    let asked = Math.min(MODE.OPTICS, Math.max(0, values.renderMode | 0))
    if (moving && asked === MODE.FULL && ((values.moveFast ?? 1) | 0) !== 0) asked = moveModeOf(values)
    v.renderMode = (values.measureMode | 0) === 0 ? asked : MODE.FULL
    if (v.renderMode === MODE.DRAFT) v.nee = 1
    if (v.renderMode === MODE.SKETCH || v.renderMode === MODE.OPTICS) { v.nee = 0; v.lt = 0 }
    if ((values.lampsOnly | 0) === 1)
        Object.assign(v, { sunIlluminance: 0, skyIlluminance: 0, studioIlluminance: 0, envUniform: 0, neeEmitShare: 0.95 })
    return v
}

/* A SETTING'S VALUE AS THE LINE SAYS IT: a switch as on / off, a choice by its option's name, a number as it is */
const spoken = (k, v, spec) => {
    const g = spec[k]?.gui ?? {}
    if (g.options) return Object.entries(g.options).find(([, x]) => same(x, v))?.[0] ?? String(v)
    if (g.min === 0 && g.max === 1 && g.step === 1) return (+v ? 'on' : 'off')
    return String(+(+v).toFixed(3))
}

/**
 * THE QUALITY BOX'S LINE (settingsui.js), so a choice is understood without its tooltip: the preset's help, or --
 * Custom -- what differs from the nearest preset, by its label: "Max Bounces 12 (Standard: 10)". The nearest is
 * the one with the fewest settings off it, Standard on a tie; only the full presets can be off (Sketch, Draft and
 * Optics are told by the mode alone). And what the view overrides: a measuring view traces in full whatever is set.
 * @returns { id, text, note } -- note is '' or the override
 */
export function describe(values, groups = UniformGroups) {
    const spec = Object.assign({}, ...Object.values(groups))
    const id = presetOf(values)
    const note = (values?.measureMode | 0) !== 0 && (values?.renderMode | 0) !== MODE.FULL
        ? 'The false-colour view traces in full: this applies to the photographic view.' : ''
    if (id !== CUSTOM) return { id, text: QUALITY_PRESETS.find(p => p.id === id).help, note }
    const off = p => Object.entries(p.values).filter(([k, v]) => !same(values?.[k], v))
    const near = QUALITY_PRESETS.filter(p => p.id === 'standard' || p.id === 'high')
        .map(p => ({ p, d: off(p) })).sort((a, b) => a.d.length - b.d.length)[0]
    const name = near.p.label.split(' (')[0]
    const diffs = near.d.map(([k, v]) => `${spec[k]?.gui?.label ?? k} ${spoken(k, values?.[k], spec)} (${name}: ${spoken(k, v, spec)})`)
    return { id, text: `Your own settings: ${diffs.join(', ')}.`, note }
}
