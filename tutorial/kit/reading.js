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
    R('iq-fbmsdf', 'Inigo Quilez', 'FBM detail in SDFs', 'article, 2019', 'https://iquilezles.org/articles/fbmsdf/'),
    R('iq-bounding', 'Inigo Quilez', 'SDF bounding volumes', 'article, 2019', 'https://iquilezles.org/articles/sdfbounding/'),

    // sphere tracing itself
    R('hart1996', 'John C. Hart', 'Sphere tracing: a geometric method for the antialiased ray tracing of implicit surfaces', 'paper, The Visual Computer, 1996'),
    R('keinert2014', 'Benjamin Keinert et al.', 'Enhanced sphere tracing', 'paper, 2014'),

    // ray tracing from nothing, and from everything
    R('rtiow', RT, 'Ray Tracing in One Weekend', 'free online book', 'https://raytracing.github.io/books/RayTracingInOneWeekend.html'),
    R('rtrest', RT, 'Ray Tracing: The Rest of Your Life', 'free online book', 'https://raytracing.github.io/books/RayTracingTheRestOfYourLife.html'),
    R('pbr', PBR, 'Physically Based Rendering: From Theory to Implementation (4th ed.)', 'free online book', 'https://pbr-book.org/4ed/contents'),
    R('pbr-radiometry', PBR, 'Physically Based Rendering (4th ed.), 4.1: Radiometry', 'free online book', 'https://pbr-book.org/4ed/Radiometry,_Spectra,_and_Color/Radiometry'),
    R('pbr-radint', PBR, 'Physically Based Rendering (4th ed.), 4.2: Working with radiometric integrals', 'free online book', 'https://pbr-book.org/4ed/Radiometry,_Spectra,_and_Color/Working_with_Radiometric_Integrals'),
    R('pbr-color', PBR, 'Physically Based Rendering (4th ed.), 4.6: Color', 'free online book', 'https://pbr-book.org/4ed/Radiometry,_Spectra,_and_Color/Color'),
    R('wyman2013', 'Chris Wyman, Peter-Pike Sloan, Peter Shirley', 'Simple analytic approximations to the CIE XYZ color matching functions', 'paper, Journal of Computer Graphics Techniques, 2013', 'https://jcgt.org/published/0002/02/01/', { credited: 'lib/pathtracer/core/spectral.js' }),
    R('krystek1985', 'Michael Krystek', 'An algorithm to calculate correlated colour temperature', 'paper, Color Research and Application, 1985', null, { credited: 'lib/pathtracer/core/colorimetry.js' }),
    R('pbr-diffuse', PBR, 'Physically Based Rendering (4th ed.), 9.2: Diffuse reflection', 'free online book', 'https://pbr-book.org/4ed/Reflection_Models/Diffuse_Reflection'),
    R('pbr-specular', PBR, 'Physically Based Rendering (4th ed.), 9.3: Specular reflection and transmission', 'free online book', 'https://pbr-book.org/4ed/Reflection_Models/Specular_Reflection_and_Transmission'),
    R('pbr-conductor', PBR, 'Physically Based Rendering (4th ed.), 9.4: Conductor BRDF', 'free online book', 'https://pbr-book.org/4ed/Reflection_Models/Conductor_BRDF'),
    R('pbr-microfacet', PBR, 'Physically Based Rendering (4th ed.), 9.6: Roughness using microfacet theory', 'free online book', 'https://pbr-book.org/4ed/Reflection_Models/Roughness_Using_Microfacet_Theory'),
    R('heitz2014', 'Eric Heitz', 'Understanding the masking-shadowing function in microfacet-based BRDFs', 'paper, Journal of Computer Graphics Techniques, 2014', 'https://jcgt.org/published/0003/02/03/', { credited: 'lib/pathtracer/core/microfacet.js' }),
    R('dupuy2023', 'Jonathan Dupuy, Anis Benyoub', 'Sampling visible GGX normals with spherical caps', 'paper, 2023', 'https://arxiv.org/abs/2306.05044', { credited: 'lib/pathtracer/core/microfacet.js' }),
    R('kulla2017', 'Christopher Kulla, Alejandro Conty', 'Revisiting physically based shading at Imageworks', 'course talk, SIGGRAPH 2017', 'https://blog.selfshadow.com/publications/s2017-shading-course/', { credited: 'lib/pathtracer/core/microfacet.js' }),
    R('turquin2019', 'Emmanuel Turquin', 'Practical multiple scattering compensation for microfacet models', 'technical memo, Industrial Light & Magic, 2019', 'https://blog.selfshadow.com/publications/turquin/ms_comp_final.pdf', { credited: 'lib/pathtracer/core/microfacet.js' }),
    R('walter2007', 'Bruce Walter, Stephen R. Marschner, Hongsong Li, Kenneth E. Torrance', 'Microfacet models for refraction through rough surfaces', 'paper, Eurographics Symposium on Rendering, 2007', null, { credited: 'lib/pathtracer/core/materials_pbr.js' }),
    R('pbr-spectra', PBR, 'Physically Based Rendering (4th ed.), 4.5: Representing spectral distributions', 'free online book', 'https://pbr-book.org/4ed/Radiometry,_Spectra,_and_Color/Representing_Spectral_Distributions'),
    R('pbr-camera', PBR, 'Physically Based Rendering (4th ed.), 5.2: Projective camera models', 'free online book', 'https://pbr-book.org/4ed/Cameras_and_Film/Projective_Camera_Models'),
    R('pbr-spheres', PBR, 'Physically Based Rendering (4th ed.), 6.2: Spheres', 'free online book', 'https://pbr-book.org/4ed/Shapes/Spheres'),
    R('pbr-sampling', PBR, 'Physically Based Rendering (4th ed.), 8: Sampling and reconstruction', 'free online book', 'https://pbr-book.org/4ed/Sampling_and_Reconstruction'),
    R('pbr-montecarlo', PBR, 'Physically Based Rendering (4th ed.), 2: Monte Carlo integration', 'free online book', 'https://pbr-book.org/4ed/Monte_Carlo_Integration'),
    R('pbr-lights', PBR, 'Physically Based Rendering (4th ed.), 12.6: Light sampling', 'free online book', 'https://pbr-book.org/4ed/Light_Sources/Light_Sampling'),
    R('pbr-efficiency', PBR, 'Physically Based Rendering (4th ed.), 2.2: Improving efficiency (importance sampling, multiple importance sampling, Russian roulette)', 'free online book', 'https://pbr-book.org/4ed/Monte_Carlo_Integration/Improving_Efficiency'),
    R('pbr-pathtracer', PBR, 'Physically Based Rendering (4th ed.), 13.4: A better path tracer', 'free online book', 'https://pbr-book.org/4ed/Light_Transport_I_Surface_Reflection/A_Better_Path_Tracer'),
    R('kajiya1986', 'James T. Kajiya', 'The rendering equation', 'paper, SIGGRAPH 1986'),
    R('veach1997', 'Eric Veach', 'Robust Monte Carlo methods for light transport simulation', 'PhD thesis, Stanford University, 1997', 'https://graphics.stanford.edu/papers/veach_thesis/'),

    // averages with error bars
    R('finch2009', 'Tony Finch', 'Incremental calculation of weighted mean and variance', 'note, University of Cambridge Computing Service, 2009', null, { credited: 'lib/pathtracer/core/wavefront.js' }),

    // geometry the renderer leans on
    R('wiki-photometry', 'Wikipedia', 'Photometry (optics)', 'encyclopedia article', 'https://en.wikipedia.org/wiki/Photometry_(optics)'),
    R('wiki-lambert', 'Wikipedia', 'Lambert\'s cosine law', 'encyclopedia article', 'https://en.wikipedia.org/wiki/Lambert%27s_cosine_law'),
    R('wiki-cie1931', 'Wikipedia', 'CIE 1931 color space', 'encyclopedia article', 'https://en.wikipedia.org/wiki/CIE_1931_color_space'),
    R('wiki-planckian', 'Wikipedia', 'Planckian locus', 'encyclopedia article', 'https://en.wikipedia.org/wiki/Planckian_locus'),
    R('wiki-rec709', 'Wikipedia', 'Rec. 709', 'encyclopedia article', 'https://en.wikipedia.org/wiki/Rec._709'),
    R('wiki-gamut', 'Wikipedia', 'Gamut', 'encyclopedia article', 'https://en.wikipedia.org/wiki/Gamut'),
    R('wiki-ev', 'Wikipedia', 'Exposure value', 'encyclopedia article', 'https://en.wikipedia.org/wiki/Exposure_value'),
    R('wiki-srgb', 'Wikipedia', 'sRGB', 'encyclopedia article', 'https://en.wikipedia.org/wiki/SRGB'),
    R('wiki-tonemapping', 'Wikipedia', 'Tone mapping', 'encyclopedia article', 'https://en.wikipedia.org/wiki/Tone_mapping'),
    R('khronos-neutral', 'Khronos', 'Khronos PBR Neutral tone mapper', 'specification, 2024', 'https://github.com/KhronosGroup/ToneMapping/tree/main/PBR_Neutral', { credited: 'lib/pathtracer/core/rendertoscreen.js' }),
    R('hable-filmic', 'John Hable', 'Filmic tonemapping operators', 'article, 2010', 'https://filmicworlds.com/blog/filmic-tonemapping-operators/', { credited: 'lib/pathtracer/core/rendertoscreen.js' }),
    R('wiki-fresnel', 'Wikipedia', 'Fresnel equations', 'encyclopedia article', 'https://en.wikipedia.org/wiki/Fresnel_equations'),
    R('wiki-beer', 'Wikipedia', 'Beer–Lambert law', 'encyclopedia article', 'https://en.wikipedia.org/wiki/Beer%E2%80%93Lambert_law'),
    R('wiki-dispersion', 'Wikipedia', 'Dispersion (optics)', 'encyclopedia article', 'https://en.wikipedia.org/wiki/Dispersion_(optics)'),
    R('wiki-abbe', 'Wikipedia', 'Abbe number', 'encyclopedia article', 'https://en.wikipedia.org/wiki/Abbe_number'),
    R('wiki-cauchy', 'Wikipedia', 'Cauchy\'s equation', 'encyclopedia article', 'https://en.wikipedia.org/wiki/Cauchy%27s_equation'),
    R('wiki-crofton', 'Wikipedia', 'Crofton formula', 'encyclopedia article', 'https://en.wikipedia.org/wiki/Crofton_formula'),

    // random numbers on a GPU
    R('oneill-pcg', 'Melissa E. O\'Neill', 'PCG, a family of better random number generators', 'website', 'https://www.pcg-random.org/'),
    R('jarzynski2020', 'Mark Jarzynski, Marc Olano', 'Hash functions for GPU rendering', 'paper, Journal of Computer Graphics Techniques, 2020', 'https://jcgt.org/published/0009/03/02/', { credited: 'lib/pathtracer/core/tracebasics.js' }),
]

export const reading = id => READING.find(r => r.id === id) ?? null
