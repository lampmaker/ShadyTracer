//======================================================================================================================
// THE ENVIRONMENT'S CODE, the builder's side (0.87.0; the renderer's is lib/pathtracer/core/environment.js, which says
// what it is, and sdf.js THE ENVIRONMENT, which says how it is called).
//
// The user (2026-11-16, 2026-11-17): "could the sun-sky be shown and edited as a code block too?" -- with "the exact
// model" in it, not a copy; "as physically correct as possible", cd/m^2; the studio a preset; the sun's place and size
// the one thing light sampling is told.
//
// SO IT IS THE SCENE'S, as its functions block is: `doc.sky`, WGSL defining `fn background(dir: VEC3) -> VEC3`, edited
// under the scene row's environment. A scene without one is lit by the renderer's default (environment.js ENV_DEFAULT:
// the sun & sky, or the studio by envMode), and the code box shows that preset's text -- the default IS those presets'
// functions, so what is shown is what is drawn. The first edit, or a start chosen, makes it the scene's own.
//
// WHERE IT IS COMPILED. In the scene's text for the builder's check (codegen.js THE SKY), after everything the kernels
// compile, so its errors are listed at its own lines (SKY_ID) and the scene's kernels never see it; and into the
// kernels that ask the environment for light (scene.sky: shade, the sun's photons, the map), which hold no scene -- so
// it reaches the prelude's shapes and noise and the environment's settings, never the functions block or a parameter
// (skyProblems says so before a compile). A change to it compiles those alone; the rest come from the pipeline cache.
//
// ITS OWN PARAMETERS (0.87.0; the user, 2026-11-17: "parameters/uniforms added"): `doc.skyParams`, names the code reads
// as they are, each a value live in one of the environment's sixteen slots (core/environment.js envWithParams, codegen
// THE SKY puts them there; model.js setSkyParams). A preset starts with its own: the stars' depth, zoom, shift, luminance
// and peak.
//======================================================================================================================
import { helpersOf, withoutComments } from './helpers.js'
import { ENV_FN, ENV_PRESETS } from '../lib/pathtracer/core/environment.js'

/** Whose lines the block's are, in the check's messages (codegen.js THE SKY): no id a node can have (ids are letters
 *  and digits), as the environment's row '#environment' is not -- so a node called sky is still a node. */
export const SKY_ID = '#sky'

/** The function the block defines (the renderer's environment.js ENV_FN). */
export const SKY_FN = ENV_FN

/** What the panel offers to start the block from: the renderer's presets, as they are -- { id, label, code, sunHint,
 *  params }, `params` the parameters the code starts with (model.js setSkyParams). */
export const SKY_PRESETS = ENV_PRESETS.map(p => ({ id: p.id, label: p.label, code: p.text, sunHint: p.sunHint, params: p.params }))
/** The sun & sky's text: what a scene without code of its own, in envMode 0, is lit by (the default's own function). */
export const SKY_TEMPLATE = SKY_PRESETS.find(p => p.id === 'sunsky').code
/** The studio's: the default in envMode 1. */
export const STUDIO_TEMPLATE = SKY_PRESETS.find(p => p.id === 'studio').code
/** The stars'. */
export const STARS_TEMPLATE = SKY_PRESETS.find(p => p.id === 'stars').code

/** Whether the block has code beyond comments: a scene without is lit by the default (codegen.js THE SKY). */
export const hasSky = text => !!withoutComments(text ?? '').trim()

/** The text a scene's environment is lit by: its own, or the default's preset for its envMode -- what the code box
 *  shows. `envMode` the scene's (model.js environmentOf), 0 when it has none. */
export const skyTextOf = (doc, envMode = 0) => hasSky(doc?.sky) ? doc.sky : (envMode | 0) === 1 ? STUDIO_TEMPLATE : SKY_TEMPLATE

/** The environment's settings a text reads, by name (UB.<name>), and whether it reads the sun's place -- what the panel
 *  shows rows for. */
export function skyReads(text) {
    const body = withoutComments(text ?? '')
    const names = new Set([...body.matchAll(/\bUB\.(\w+)/g)].map(m => m[1]))
    // the image's lookup reads its turn itself (core/envimage.js)
    const image = /\benvImage\s*\(/.test(body)
    if (image) names.add('envImageTurn')
    return { names, sun: /\b(sunDirection|inSunDisc|inSunCone)\s*\(/.test(body), image }
}

/** What is wrong with a sky block as text, as lines (none: it is sound). `functions` is the scene's functions block:
 *  the sky is compiled without it (shade holds no scene), so a name of it the sky reads and does not define itself
 *  would compile in the builder's check and fail in the kernel -- said here instead. */
export function skyProblems(text, functions = '') {
    if (text == null) return []
    if (typeof text !== 'string') return ['sky must be a string of WGSL']
    if (!hasSky(text)) return []
    const own = helpersOf(text)
    const p = []
    if (!own.some(x => x.kind === 'fn' && x.name === SKY_FN)) p.push(`sky: the block must define fn ${SKY_FN}(dir: VEC3) -> VEC3`)
    const mine = new Set(own.map(x => x.name))
    const body = withoutComments(text)
    for (const h of helpersOf(functions)) {
        if (mine.has(h.name) || !new RegExp(`\\b${h.name}\\b`).test(body)) continue
        p.push(`sky: '${h.name}' is the functions block's, and the sky is compiled without it -- copy it into the sky's block`)
    }
    return p
}
