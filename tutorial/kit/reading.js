//======================================================================================================================
// THE READING LIST, as data: every outside source the tutorial recommends or credits, written once, so a link is
// checked once. A page names one by id inside a reading box,
//     <aside class="refs"><span class="tag">Read more</span><ul><li data-ref="iq-smin">why, for this page</li></ul></aside>
// and page.js writes its title, link and author in front of the reason; a glossary entry names them too (`read`).
// The test holds every data-ref to an id here, every link to https, and every planned chapter's `read` in PLAN.md.
//
// "Where you learned it" is only said where it is known: `credited` names the file whose own comments credit the
// source (the test checks that file mentions the author), and a page's box can cite those lines. Everything else is
// a recommendation: what a reader should go to next, not a claim about how the code came to be.
//
// `checked` is the day each link was last opened and found to be the work named (the test cannot reach the web).
// A source without a link is a paper cited by its title, where no stable free copy could be confirmed.
//======================================================================================================================

const R = (id, who, title, kind, href = null, extra = {}) => ({ id, who, title, kind, href, checked: href ? '2026-10-18' : null, ...extra })
const PBR = 'Matt Pharr, Wenzel Jakob, Greg Humphreys', RT = 'Peter Shirley, Trevor David Black, Steve Hollasch'

export const READING = [
    // Inigo Quilez: the distance functions, the blends and most of what is known about rendering them, written for
    // people who want to make pictures with them. ShadyTracer's shapes follow his list (README.md, Licence and credits).
    R('iq-distfunctions', 'Inigo Quilez', 'Distance functions', 'article', 'https://iquilezles.org/articles/distfunctions/', { credited: 'lib/pathtracer/core/sdf.js' }),
    R('iq-distfunctions2d', 'Inigo Quilez', '2D distance functions', 'article', 'https://iquilezles.org/articles/distfunctions2d/'),
    R('iq-smin', 'Inigo Quilez', 'Smooth minimum', 'article, 2013', 'https://iquilezles.org/articles/smin/'),
    R('iq-raymarching', 'Inigo Quilez', 'Raymarching distance fields', 'article, 2008', 'https://iquilezles.org/articles/raymarchingdf/'),
    R('iq-distance', 'Inigo Quilez', 'Distance estimation', 'article, 2011', 'https://iquilezles.org/articles/distance/'),
    R('iq-interior', 'Inigo Quilez', 'Interior SDFs', 'article, 2020', 'https://iquilezles.org/articles/interiordistance/'),
    R('iq-normals', 'Inigo Quilez', 'Normals for an SDF', 'article, 2015', 'https://iquilezles.org/articles/normalsSDF/'),
    R('iq-bounding', 'Inigo Quilez', 'SDF bounding volumes', 'article, 2019', 'https://iquilezles.org/articles/sdfbounding/'),

    // sphere tracing itself
    R('hart1996', 'John C. Hart', 'Sphere tracing: a geometric method for the antialiased ray tracing of implicit surfaces', 'paper, The Visual Computer, 1996'),
    R('keinert2014', 'Benjamin Keinert et al.', 'Enhanced sphere tracing', 'paper, 2014'),

    // ray tracing from nothing, and from everything
    R('rtiow', RT, 'Ray Tracing in One Weekend', 'free online book', 'https://raytracing.github.io/books/RayTracingInOneWeekend.html'),
    R('rtrest', RT, 'Ray Tracing: The Rest of Your Life', 'free online book', 'https://raytracing.github.io/books/RayTracingTheRestOfYourLife.html'),
    R('pbr-camera', PBR, 'Physically Based Rendering (4th ed.), 5.2: Projective camera models', 'free online book', 'https://pbr-book.org/4ed/Cameras_and_Film/Projective_Camera_Models'),
    R('pbr-spheres', PBR, 'Physically Based Rendering (4th ed.), 6.2: Spheres', 'free online book', 'https://pbr-book.org/4ed/Shapes/Spheres'),
    R('pbr-sampling', PBR, 'Physically Based Rendering (4th ed.), 8: Sampling and reconstruction', 'free online book', 'https://pbr-book.org/4ed/Sampling_and_Reconstruction'),
    R('pbr-montecarlo', PBR, 'Physically Based Rendering (4th ed.), 2: Monte Carlo integration', 'free online book', 'https://pbr-book.org/4ed/Monte_Carlo_Integration'),
    R('pbr-lights', PBR, 'Physically Based Rendering (4th ed.), 12.6: Light sampling', 'free online book', 'https://pbr-book.org/4ed/Light_Sources/Light_Sampling'),
    R('pbr-pathtracer', PBR, 'Physically Based Rendering (4th ed.), 13.4: A better path tracer', 'free online book', 'https://pbr-book.org/4ed/Light_Transport_I_Surface_Reflection/A_Better_Path_Tracer'),
    R('veach1997', 'Eric Veach', 'Robust Monte Carlo methods for light transport simulation', 'PhD thesis, Stanford University, 1997', 'https://graphics.stanford.edu/papers/veach_thesis/'),

    // random numbers on a GPU
    R('jarzynski2020', 'Mark Jarzynski, Marc Olano', 'Hash functions for GPU rendering', 'paper, Journal of Computer Graphics Techniques, 2020', 'https://jcgt.org/published/0009/03/02/', { credited: 'lib/pathtracer/core/tracebasics.js' }),
]

export const reading = id => READING.find(r => r.id === id) ?? null
