//======================================================================================================================
// THE CONTENTS, as data: the map (tutorial/index.html), every page's prev / next and title block, and chapter links
// (data-ch="id#anchor") all read it, and the test holds the pages to it. A chapter is `planned` until its page exists,
// `draft` while it is being judged, `done` once read against the code it explains.
//
// Ids, not numbers, are what links use: the numbers will move as chapters are written.
//
// `code`: the files (or folders, ending in /) a chapter is ABOUT, planned ones too. A page's excerpts, citations and
// imports tie it to the lines it shows; this ties its prose to what it explains, so a change to a file that no page
// quotes still finds the chapter (or the plan line) that describes it: tutorial/review/affected.mjs reads both, and
// the test fails on a path that no longer exists (a renamed file would leave the chapter quietly unwatched).
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

const C = (part, id, title, line, status = 'planned', code = []) => ({ part, id, title, line, status, code, file: status === 'planned' ? null : `ch/${id}.html` })
const P = 'lib/pathtracer/', K = 'lib/pathtracer/core/'

export const CHAPTERS = [
    C('start', 'reading', 'How to read this', 'What the figures, stamps and fold-outs mean; running the program and its tests.', 'draft',
        [`${P}tests.js`, 'docs/TESTING.md', `${K}check-shaders.mjs`, '.github/workflows/test.yml', 'tutorial/kit/legend.js']),

    C('rays', 'rays', 'Rays make a picture', 'How a picture is made by sending a ray through every pixel, and why from the eye.', 'draft',
        [`${K}genrays.js`, 'lib/camera.js']),
    C('rays', 'distances', 'Shapes as distances', 'How a ray finds the first surface in its way, using nothing but distances.', 'draft',
        ['help/widgets.js', `${K}shapes.js`, `${K}tolerances.js`]),
    C('rays', 'shapes', 'Building and bending shapes', 'Joining, melting, twisting and roughening shapes, and keeping them safe to trace.', 'draft',
        [`${K}scene_api.js`, `${K}shapes.js`, `${K}noise.js`, 'builder/modifiers.js', 'builder/codegen.js', 'help/widgets.js']),
    C('rays', 'normals', 'Which way is up', 'Which way a surface faces, and what it costs to find out.', 'draft',
        [`${K}pick.js`, `${K}tracebasics.js`, `${K}tolerances.js`, `${K}sdf.js`, 'lib/pathtracer/PRECISION.md', `${K}test/floor.test.mjs`]),

    C('light', 'photometry', 'Measuring light', 'The units of light (lumen, candela, lux), how light weakens with distance and slant, the sun.', 'planned',
        [`${K}photometry.js`, `${K}sdf.js`]),
    C('light', 'colour', 'Colour', 'How three numbers stand for a colour, and what colour temperature means.', 'planned',
        [`${K}colorimetry.js`, `${K}spectral.js`]),
    C('light', 'pixels', 'From light to pixels', 'From light to the brightness of a screen: exposure and tone.', 'planned',
        [`${K}autoexposure.js`, `${K}rendertoscreen.js`, `${P}develop.js`]),

    C('surfaces', 'diffuse', 'Diffuse and mirror', 'Where light goes when it hits a matte surface or a mirror; a test that no light is made or lost.', 'planned',
        [`${K}materials.js`]),
    C('surfaces', 'microfacets', 'Rough and shiny', 'Rough and shiny surfaces as many tiny mirrors, without losing light.', 'planned',
        [`${K}microfacet.js`, `${K}materials_pbr.js`]),
    C('surfaces', 'glass', 'Glass', 'Light bending into glass, reflecting off it, and coloured by it.', 'planned',
        [`${P}optics/fresnel.js`, `${K}materials_pbr.js`]),
    C('surfaces', 'dispersion', 'Rainbows', 'Why glass splits white light into colours, and how a renderer follows each colour.', 'planned',
        [`${K}spectral.js`]),

    C('paths', 'montecarlo', 'Dice and averages', 'Averages of random tries: why they are noisy, and how fast the noise falls.', 'draft',
        [`${K}measure.js`, `${K}noise.js`, `${K}tracebasics.js`, `${K}wavefront.js`, `${K}uniforms.schema.js`]),
    C('paths', 'paths', 'Following a path', 'Following light bounce by bounce, and choosing the bounces that matter.', 'draft',
        [`${K}materials_pbr.js`, `${K}tracebasics.js`, `${K}uniforms.schema.js`, 'tutorial/kit/flatland.js']),
    C('paths', 'nee', 'Aim at the light', 'Aiming a ray at the lamp at every bounce: next event estimation.', 'draft',
        [`${K}tracebasics.js`, `${K}materials_pbr.js`]),
    C('paths', 'mis', 'Two ways to the light', 'Two ways of finding light, combined without counting it twice.', 'draft',
        [`${K}tracebasics.js`, `${K}materials_pbr.js`]),
    C('paths', 'emitters', 'Every glowing thing is a light', 'Finding the glowing surfaces in a scene, so they can be aimed at too.', 'draft',
        [`${K}tracebasics.js`, `${K}materials_pbr.js`, `${K}wavefront.js`]),
    C('paths', 'lens', 'The camera\'s lens', 'A camera with a lens: focus and blur.', 'planned',
        [`${K}lens.js`]),

    C('hard', 'caustics', 'Caustics', 'Light focused through glass onto a floor, and why the camera cannot find it.', 'planned',
        [`${K}tracebasics.js`, `${K}genrays.js`]),
    C('hard', 'photons', 'Photon mapping', 'Sending light out from the lamps and remembering where it lands.', 'planned',
        [`${K}sppm.js`]),
    C('hard', 'haze', 'Dust in the air', 'Dust and fog in the air: light scattered on its way, and beams you can see.', 'planned',
        [`${K}haze.js`, 'builder/hazebox.js']),

    C('machine', 'gpu', 'A GPU for beginners', 'How a graphics card runs thousands of copies of one program, and how to give it work.', 'planned',
        ['lib/tinywebgpu']),
    C('machine', 'wavefront', 'Wavefront path tracing', 'Splitting the renderer into small programs that pass rays along, to keep the card busy.', 'planned',
        [`${K}wavefront.js`, `${K}raytrace_main.js`]),
    C('machine', 'accumulate', 'Adding up light on a GPU', 'Adding up the light of millions of rays into pixels, on a graphics card.', 'planned',
        [`${K}photons.js`, `${K}raytrace_main.js`]),
    C('machine', 'codegen', 'From scene tree to shader', 'Turning a scene into a program for the graphics card, and making that program fast.', 'planned',
        ['builder/codegen.js', 'builder/bake.js', 'builder/scenedata.js']),

    C('speed', 'measure', 'Measure first', 'Timing the graphics card, and a plan built on guesses that was undone.', 'planned',
        [`${K}kerneltime.js`, `${P}tests.js`, 'bench/', 'docs/PERFORMANCE.md']),
    C('speed', 'steps', 'Fewer and cheaper steps', 'Making each ray take fewer and cheaper steps; what was tried and taken out again.', 'planned',
        ['builder/boxes.js', 'builder/stepbox.js', `${K}wavefront.js`]),
    C('speed', 'compiles', 'Faster compiles', 'Getting a scene\'s programs ready sooner.', 'planned',
        [`${K}compileprogress.js`]),
    C('speed', 'feel', 'Feeling fast', 'Keeping the program quick to answer while it renders.', 'planned',
        [`${P}quality.js`, `${P}interaction.js`, `${P}samples.js`]),

    C('right', 'checking', 'Noise, bias and checking', 'How to tell a renderer is right: answers known in advance, and tests.', 'planned',
        ['docs/TESTING.md', `${K}measure.js`]),
    C('right', 'precision', 'Numbers have grain', 'Why a computer\'s numbers have grain, and how the renderer lives with it.', 'planned',
        [`${K}tolerances.js`, `${P}PRECISION.md`, `${K}units.js`, `${K}unitlint.js`]),
    C('right', 'optics', 'The optics bench', 'Measuring light like a lab bench: beams, maps of light on a wall, ray files.', 'planned',
        [`${P}optics/`]),

    C('build', 'yours', 'A ray tracer in one page', 'The flat world of these figures explained line by line, then extended by you.', 'planned',
        []),
    C('build', 'open', 'Open problems', 'What is not built yet, and the case for each.', 'planned',
        ['docs/PERFORMANCE.md', 'roadmap/PLAN.md']),
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
