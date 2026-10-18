//======================================================================================================================
// THE CONTENTS, as data: the map (tutorial/index.html), every page's prev / next and title block, and chapter links
// (data-ch="id#anchor") all read it, and the test holds the pages to it. A chapter is `planned` until its page exists,
// `draft` while it is being judged, `done` once read against the code it explains.
//
// Ids, not numbers, are what links use: the numbers will move as chapters are written.
//======================================================================================================================

export const TITLE = 'ShadyTracer, inside out'

export const PARTS = [
    { id: 'start', title: 'Start here' },
    { id: 'rays', title: 'Seeing with rays' },
    { id: 'light', title: 'What light is' },
    { id: 'surfaces', title: 'What surfaces do' },
    { id: 'paths', title: 'Path tracing' },
    { id: 'hard', title: 'Light the camera can\'t find' },
    { id: 'machine', title: 'The machine' },
    { id: 'speed', title: 'Speed' },
    { id: 'right', title: 'Getting it right' },
    { id: 'build', title: 'Build your own' },
]

const C = (part, id, title, line, status = 'planned') => ({ part, id, title, line, status, file: status === 'planned' ? null : `ch/${id}.html` })

export const CHAPTERS = [
    C('start', 'reading', 'How to read this', 'The figures, the stamps, the fold-outs; running the app and its tests.'),

    C('rays', 'rays', 'Rays make a picture', 'A pinhole camera, one ray per pixel, tracing from the eye, jitter.', 'draft'),
    C('rays', 'distances', 'Shapes as distances', 'Signed distance fields and sphere tracing: how a ray finds a surface.', 'draft'),
    C('rays', 'shapes', 'Building and bending shapes', 'Union, blends, twists and noise -- and the rule that keeps them safe.'),
    C('rays', 'normals', 'Which way is up', 'Normals from the field\'s slope, and what they cost.'),

    C('light', 'photometry', 'Measuring light', 'Lumen, candela, lux, cd/m2; the inverse-square and cosine laws; the sun.'),
    C('light', 'colour', 'Colour', 'Three cones, colour matching, chromaticity, colour temperature.'),
    C('light', 'pixels', 'From light to pixels', 'Exposure, auto-exposure, tone curves, sRGB.'),

    C('surfaces', 'diffuse', 'Diffuse and mirror', 'Where light goes when it hits something; the white furnace.'),
    C('surfaces', 'microfacets', 'Rough and shiny', 'Microfacets, GGX, roughness, and keeping energy.'),
    C('surfaces', 'glass', 'Glass', 'Snell, Fresnel, total internal reflection, colour from absorption.'),
    C('surfaces', 'dispersion', 'Rainbows', 'Dispersion from the Abbe number, wavelengths per channel, coatings.'),

    C('paths', 'montecarlo', 'Dice and averages', 'Monte Carlo, noise, the error bar, random numbers.'),
    C('paths', 'paths', 'Following a path', 'Bounces, throughput, importance sampling, Russian roulette.'),
    C('paths', 'nee', 'Aim at the light', 'Next event estimation: a shadow ray at every bounce.', 'draft'),
    C('paths', 'mis', 'Two ways to the light', 'Multiple importance sampling and the power heuristic.'),
    C('paths', 'emitters', 'Every glowing thing is a light', 'Finding emissive surfaces, unbiased from the first sample.'),
    C('paths', 'lens', 'The camera\'s lens', 'A thin lens, focus and depth of field.'),

    C('hard', 'caustics', 'Caustics', 'Light through glass onto a floor, and why the camera cannot find it.'),
    C('hard', 'photons', 'Photon mapping', 'Photons in a hashed grid, a shrinking radius, the budget.'),
    C('hard', 'haze', 'Dust in the air', 'Participating media: transmittance, Henyey-Greenstein, god rays.'),

    C('machine', 'gpu', 'A GPU for beginners', 'Lock-step workers, WGSL, buffers, pipelines, dispatch.'),
    C('machine', 'wavefront', 'Wavefront path tracing', 'Kernels and queues instead of one giant program.'),
    C('machine', 'accumulate', 'Adding up light on a GPU', 'No float atomics, one resolve a sample, batches.'),
    C('machine', 'codegen', 'From scene tree to shader', 'Codegen, uniforms and constants, baking, the scene as data.'),

    C('speed', 'measure', 'Measure first', 'GPU timestamps, drift, and the plan that was reverted.'),
    C('speed', 'steps', 'Fewer and cheaper steps', 'Culling boxes, relief shells, the step cache, what was removed.'),
    C('speed', 'compiles', 'Faster compiles', 'Off-thread compiles, one copy of the scene, the pipeline cache.'),
    C('speed', 'feel', 'Feeling fast', 'The governor, fast-while-moving, presets, the 2 s watchdog.'),

    C('right', 'checking', 'Noise, bias and checking', 'Unbiased and consistent, closed forms, JS mirrors.'),
    C('right', 'precision', 'Numbers have grain', 'f32 spacing, one tolerance, offsets, metres inside.'),
    C('right', 'optics', 'The optics bench', 'Far field, illuminance maps, ray files.'),

    C('build', 'yours', 'A ray tracer in one page', 'Flatland explained line by line, then extended.'),
    C('build', 'open', 'Open problems', 'What is not built yet, and the case for each.'),
]
CHAPTERS.forEach((c, i) => { c.number = i })   // "How to read this" is 0

export const chapter = id => CHAPTERS.find(c => c.id === id) ?? null
export const partOf = c => PARTS.find(p => p.id === c.part)

/** The written chapters before and after `id`, skipping planned ones: prev / next only lead to pages that exist. */
export function neighbours(id) {
    const live = CHAPTERS.filter(c => c.file)
    const i = live.findIndex(c => c.id === id)
    return { prev: i > 0 ? live[i - 1] : null, next: i >= 0 && i < live.length - 1 ? live[i + 1] : null }
}
