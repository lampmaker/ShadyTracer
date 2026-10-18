//======================================================================================================================
// THE GLOSSARY, as data: the glossary page lists it, a term in any page (data-g="id") links to its entry and shows
// `short` in a card, and the test holds every data-g to an id here and every `ch` to a chapter. `ch` is the chapter
// that explains the term properly; `see` are related entries.
//
// Written for someone who has never met the word: one or two plain sentences, no other jargon where it can be
// avoided, and where it cannot, that word is an entry too.
//======================================================================================================================

const G = (id, term, short, ch, see = []) => ({ id, term, short, ch, see })

export const GLOSSARY = [
    // seeing with rays
    G('ray', 'ray', 'A starting point and a direction: a line that goes one way for ever. A ray tracer follows rays to find what they hit.', 'rays', ['camera-ray']),
    G('pixel', 'pixel', 'One dot of the picture. A picture of 1920 × 1080 has about two million of them, each with one colour.', 'rays', ['resolution']),
    G('resolution', 'resolution', 'How many pixels a picture has across and down. More pixels, finer detail, more work.', 'rays', ['pixel']),
    G('pinhole', 'pinhole camera', 'A camera with no lens: every ray goes through one point, the eye. Everything is sharp at every distance.', 'rays', ['lens']),
    G('fov', 'field of view', 'How wide the camera sees, as an angle. Wide angles fit more in and stretch the edges.', 'rays'),
    G('camera-ray', 'camera ray', 'A ray from the eye through a pixel, out into the scene. Also called a primary ray. Finding what it hits says what that pixel shows.', 'rays', ['ray', 'pixel']),
    G('shadow-ray', 'shadow ray', 'A ray from a point on a surface towards a light, asking one question: is anything in the way? If not, the point is lit.', 'nee', ['nee']),
    G('jitter', 'jitter', 'Sending each sample\'s ray through a random point inside its pixel instead of the middle, so edges come out smooth on average.', 'rays', ['aliasing', 'sample']),
    G('aliasing', 'aliasing', 'The stair steps along an edge when each pixel looks in one exact direction: the pixel is all in or all out, never part.', 'rays', ['jitter']),
    G('sample', 'sample', 'One try: one ray (or path) per pixel. A picture is the average of many samples; each one adds a little less noise.', 'montecarlo', ['spp', 'noise']),
    G('spp', 'samples per pixel', 'How many samples have been averaged into each pixel so far. ShadyTracer keeps adding them while the picture stands still.', 'montecarlo', ['sample']),
    G('lens', 'lens (thin lens)', 'A camera with a lens instead of a pinhole: rays start from anywhere on the lens and meet again at one distance, the focus. Things nearer or further are blurred: depth of field.', 'lens', ['pinhole']),
    G('flatland', 'flat world', 'The tutorial\'s 2D stand-in for the renderer: the same ideas in a slice, so they can be drawn. Some formulas differ (light spreads around a circle, not a sphere), and the pages say where.', 'reading'),

    // distances
    G('sdf', 'signed distance field (SDF)', 'A function that says, for any point, how far it is to the nearest surface: positive outside, negative inside, zero on the surface. ShadyTracer\'s shapes are all SDFs.', 'distances', ['sphere-tracing']),
    G('sphere-tracing', 'sphere tracing', 'Finding where a ray meets an SDF by stepping: ask the distance, move that far (nothing is closer, so nothing can be skipped), repeat until the distance is tiny. Also called ray marching.', 'distances', ['sdf', 'tolerance']),
    G('tolerance', 'surface tolerance', 'How close is close enough to count as a hit. Too large and surfaces look soft; too small and rays take many more steps, or never arrive.', 'distances', ['f32']),
    G('stepscale', 'step scale', 'A safety factor on each step: ShadyTracer moves 0.9 of the distance, not all of it, so a distance that is slightly too large cannot carry the ray through a surface.', 'distances', ['lipschitz']),
    G('lipschitz', 'Lipschitz bound', 'A promise about a distance field: it never changes faster than the real distance does. Break it, and a step can jump over a surface. Divide by how much faster it changes, and it is safe again.', 'distances', ['sdf']),
    G('union', 'union', 'Two shapes as one: the distance to either, so the smaller of the two distances.', 'shapes', ['csg', 'smin']),
    G('csg', 'CSG (constructive solid geometry)', 'Building shapes from shapes: union (both), intersection (where they overlap), subtraction (one with the other cut out).', 'shapes', ['union']),
    G('smin', 'smooth blend', 'A union that melts two shapes together near where they meet, instead of a sharp crease. It shortens the distance a little where both are close.', 'shapes', ['union']),
    G('normal', 'normal', 'The direction straight out of a surface at a point. Light bounces, reflects and refracts relative to it. For an SDF it is the direction the distance grows fastest.', 'normals'),
    G('escape', 'escape', 'A ray that leaves the scene: ShadyTracer stops marching once a ray is outside the scene\'s radius and moving away, and gives it the sky.', 'distances'),

    // light
    G('radiance', 'radiance', 'How bright a surface looks from one direction: what a camera pixel measures. ShadyTracer stores it as luminance, in candela per square metre (cd/m²).', 'photometry', ['irradiance']),
    G('irradiance', 'irradiance', 'How much light lands on a surface, from all directions together. Measured for the eye it is illuminance, in lux.', 'photometry', ['radiance']),
    G('cosine-law', 'cosine law', 'Light arriving at a slant spreads over more surface, so it lights it less: by the cosine of the angle from the normal.', 'photometry', ['normal']),
    G('albedo', 'albedo', 'The share of light a surface sends back out: 1 is white, 0 is black, 0.7 a light grey. The rest is absorbed.', 'diffuse'),
    G('diffuse', 'diffuse', 'A matte surface that scatters light in every direction, looking equally bright from all of them. Paper, chalk, a painted wall. Also called Lambertian.', 'diffuse', ['albedo', 'bsdf']),
    G('bsdf', 'BSDF', 'A material\'s rule for where light goes when it hits: how much leaves in each direction for light arriving from each direction. Short for bidirectional scattering distribution function.', 'diffuse', ['diffuse']),
    G('delta', 'mirror-like (delta) direction', 'A perfect mirror or clear glass sends light in exactly one direction. A random direction never hits it, so light sampling cannot help there.', 'mis', ['nee', 'caustic']),
    G('emitter', 'emitter', 'Anything that gives off light: a lamp, the sun, a glowing surface.', 'emitters'),

    // path tracing
    G('path', 'path', 'The chain of rays one sample follows: from the eye to a surface, bouncing to the next, until it reaches a light, leaves the scene or is stopped.', 'paths', ['bounce']),
    G('bounce', 'bounce', 'One step of a path: hitting a surface and leaving it in a new direction chosen by the material.', 'paths', ['path', 'bsdf']),
    G('path-tracing', 'path tracing', 'Making a picture by following many random paths from the eye and averaging what light they bring back. Done right, the average converges to the true picture.', 'paths', ['montecarlo']),
    G('throughput', 'throughput', 'How much of the light found at the end of a path still reaches the eye: each bounce multiplies it by what the surface keeps. ShadyTracer calls it beta.', 'paths'),
    G('montecarlo', 'Monte Carlo', 'Working out an average by trying random cases and averaging them. The more tries, the closer the answer; the error falls as one over the square root of the number of tries.', 'montecarlo', ['noise', 'estimator']),
    G('estimator', 'estimator', 'A recipe that turns random tries into a guess at a number. A good one guesses right on average and does not scatter much.', 'montecarlo', ['unbiased']),
    G('unbiased', 'unbiased', 'Right on average: the mean of many tries is the true answer, however few tries each picture had. The noise is the only error.', 'checking', ['estimator']),
    G('noise', 'noise', 'The speckle in a picture made from too few samples: each pixel\'s average has not settled yet. Four times the samples halve it.', 'montecarlo', ['variance', 'error-bar']),
    G('variance', 'variance', 'How much the tries scatter around their average. Lower variance means less noise for the same number of samples.', 'montecarlo', ['noise']),
    G('error-bar', 'error bar', 'How far a pixel\'s average might still be from its true value, worked out from how much its samples disagree (its standard error). ShadyTracer keeps one for every pixel.', 'montecarlo', ['noise']),
    G('pdf', 'probability density (pdf)', 'How likely a random choice is to land at each value. An estimator divides by it, so a choice made often counts less each time and a rare one counts more: on average it comes out right.', 'nee', ['importance']),
    G('importance', 'importance sampling', 'Choosing random directions more often where they matter more (towards bright light, along a shiny reflection) and dividing by how often you chose them. Same answer on average, much less noise.', 'paths', ['pdf']),
    G('nee', 'next event estimation (NEE)', 'At every bounce, also send a shadow ray to a random point of a light. A bounce finds a small light by luck; NEE aims at it.', 'nee', ['shadow-ray', 'mis']),
    G('direct', 'direct light', 'Light that reaches a point straight from a light. Indirect light has bounced off something else first.', 'nee'),
    G('mis', 'multiple importance sampling (MIS)', 'Using two ways of choosing a direction at once (aim at the light, follow the material) and weighting each by how good it is for that direction, so neither can make a firefly.', 'mis', ['nee', 'importance']),
    G('firefly', 'firefly', 'A single far-too-bright pixel: a rare sample that found a lot of light and was divided by a tiny pdf.', 'mis', ['pdf']),
    G('caustic', 'caustic', 'Light focused by glass or a mirror onto a surface: the bright pattern under a glass of water. Hard for a camera path to find, because it has to pass through the glass the exact right way.', 'caustics', ['delta']),

    // the machine
    G('gpu', 'GPU', 'A graphics card: thousands of small processors that run the same program on different data at the same time. Each pixel\'s ray can be one of them.', 'gpu', ['kernel']),
    G('kernel', 'kernel', 'A program that runs on the GPU, once for every item of work (every pixel, every ray). ShadyTracer\'s frame is a dozen kernels in turn.', 'gpu', ['wgsl', 'wavefront']),
    G('wgsl', 'WGSL', 'The language WebGPU programs are written in. ShadyTracer\'s kernels are WGSL text inside JavaScript files.', 'gpu', ['kernel']),
    G('webgpu', 'WebGPU', 'The browser\'s way of running programs on the graphics card. ShadyTracer uses it through a small library of its own, tinywebgpu.', 'gpu', ['wgsl']),
    G('wavefront', 'wavefront', 'Running a path tracer as several kernels with queues between them (march, shade, shadow rays) instead of one big program, so the GPU\'s workers stay busy with the same kind of work.', 'wavefront', ['kernel']),
    G('f32', 'f32 (32-bit float)', 'The kind of number the GPU computes with: about seven significant digits. Far from the origin its steps get coarse, which limits how small a tolerance can be.', 'precision', ['tolerance']),
]

export const term = id => GLOSSARY.find(g => g.id === id) ?? null
