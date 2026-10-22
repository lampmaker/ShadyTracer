//======================================================================================================================
// OPEN PROBLEMS -- chapter 33's board. Pure data, every item held by the tutorial's test to the document it comes from,
// so the board cannot drift from the documents: a row's status to its line in docs/TESTING.md, and every other item's
// words to the file that states them (`quote` must be found in `src` as it is today). When a row is pressed or a
// comment fixed, the test fails and the chapter is brought up to date; a new open row in TESTING.md fails it too.
//
// The kinds, in the board's order:
//   never        built as a bench row and never pressed on a card: what it would tell is not known
//   once         pressed once, the question still open
//   unexplained  measured on a real card, and the documents do not say why
//   designed     a fix or a feature the plan describes and nobody has built
//   limit        something the renderer gets wrong, or leaves to chance, and its documents say so
//   found        a comment, a document or a line of code this tutorial found at odds with the code or its own numbers
//======================================================================================================================

/* [kind, its name, its short name for the board's columns] */
export const KINDS = [
    ['never', 'built, never run on a card', 'never run'],
    ['once', 'run once, still open', 'run once'],
    ['unexplained', 'measured, not explained', 'unexplained'],
    ['designed', 'designed, not built', 'not built'],
    ['limit', 'a limit, stated', 'limits'],
    ['found', 'found by this tutorial', 'found here'],
]

const T = 'docs/TESTING.md'
/* A bench row: its id in TESTING.md's table, the start of its status there (`status`), its question (the row's own
   words, `quote`), the chapter that teaches what it checks, and the question in a few plain words for its card. */
const row = (id, kind, status, quote, ch, title) => ({ id, kind, src: T, status, quote, ch, title: title ?? id })

export const ITEMS = [
    row('error-bar', 'never', 'open — first press.', "Whether each pixel's reported standard error is the noise it really has", 'checking', 'is each error bar the real noise?'),
    row('illuminance', 'never', 'open — first press.', 'Whether the illuminance view reads the lux falling on a surface whatever the surface is', 'photometry', 'does the lux view read true?'),
    row('cosine-law', 'never', 'open — first press.', 'Whether a tilted surface receives E_sun sin(elevation + tilt) under the sun alone', 'rays', 'does a tilted floor get its sun?'),
    row('disc-light', 'never', 'open — first press. The first absolute check of an emitter.', 'Whether an emitter lights the floor as arithmetic says', 'emitters', 'does a glowing disc light the floor right?'),
    row('render-modes', 'never', 'open — built 2026-10-01, never pressed.', 'Whether Draft keeps the direct light exactly', 'feel', 'does Draft keep the direct light?'),
    row('draft-lamps', 'never', 'open — built 2026-10-01, never pressed.', 'Whether Draft finds a lamp the camera cannot see', 'feel', 'does Draft find a lamp out of view?'),
    row('scale', 'never', 'open — first press.', "Whether the surface tolerance follows the scene's size", 'precision', 'does the tolerance follow the size?'),
    row('optics-balance', 'once', 'open — the shell not yet pressed.', 'Whether the optics trace ends every ray where arithmetic says', 'optics', 'does every optics ray end right?'),
    row('optics-farfield', 'never', 'open — first press.', "Whether the far-field grid (the Intensity tab) gives a source's known curve", 'optics', 'does the far field give known curves?'),
    row('optics-absorption', 'never', 'open — first press.', 'Whether glass absorbs with its thickness', 'glass', 'does glass absorb with thickness?'),
    row('optics-coating', 'never', 'open — first press.', 'reflects and passes what it says', 'dispersion', 'does a coating do what it says?'),
    row('optics-dispersion', 'never', 'open — first press.', 'fans white light as Snell and Cauchy say', 'dispersion', 'does glass fan white light right?'),
    row('frame-cost', 'never', 'open — needs a real card.', 'What the f32 compare-and-swap frame buffer costs.', 'accumulate', 'what does the frame buffer cost?'),
    row('render-modes-cost', 'never', 'open — built 2026-10-01, never pressed.', 'What the Quality presets cost on the scene and view you have', 'feel', 'what does each Quality preset cost?'),
    row('small-caustic', 'never', 'open — built 2026-10-02, not pressed.', "keeps the picture and cuts a small scene's caustic noise", 'caustics', "a small scene's caustic, quieter?"),
    row('sppm', 'never', 'open — built 2026-10-15, not pressed.', "Whether the photon map (0.60.0, on by default since 0.61.0, `core/sppm.js`) adds exactly what the camera's rays then leave it", 'photons', 'does the photon map add its share?'),
    row('small-emitter', 'never', 'open — built 2026-10-02, not pressed.', 'Whether a small emitter, aimed at with a margin of its own size', 'emitters', 'does a tiny glow still light right?'),
    row('nee-cost', 'never', 'open — needs a real card.', 'What the occlusion queue costs.', 'wavefront', 'what does the occlusion queue cost?'),
    row('iteration-cost', 'never', 'open.', 'What a wavefront iteration actually costs', 'wavefront', 'what does an iteration cost?'),
    row('nee-split', 'once', 'open — one press.', 'Which half of light sampling is wrong, disc or sky.', 'nee', 'which half of light sampling is off?'),
    { id: 'firefly-clamp', kind: 'never', src: T, quote: 'The two firefly-clamp rows are in no recorded press.', ch: 'checking', title: 'the firefly-clamp rows',
        note: 'Two rows of the photometry test, which itself passes; these two have never been pressed.' },

    /* MEASURED, NOT EXPLAINED: each in its document's words */
    { id: 'rough-glass', kind: 'unexplained', src: 'roadmap/SURFACES.md', quote: '0.9440 in every run since (946 wide)', ch: 'checking', title: 'rough glass reads 0.944',
        note: 'The furnace\'s rough glass read 0.9587 on the Pascal, which a single-scatter reference explains, then 0.9872 and 0.9440 on the Ampere: "Not explained yet."' },
    { id: 'ampere-compile', kind: 'unexplained', src: 'docs/PERFORMANCE.md', quote: 'The ~4 s and the 21-23 s have not been reconciled.', ch: 'compiles', title: 'the Ampere\'s compile, 4 s or 21',
        note: 'A compile profile read about 4 s; the benchmark\'s uncached compile of the Noise library, 21.2 and 22.7 s on the same card (7.9-8.1 s on a 1080 Ti).' },
    { id: 'drift', kind: 'unexplained', src: 'docs/PERFORMANCE_REVIEW.md', quote: 'is good to about ±20%', ch: 'measure', title: 'the card\'s ±20% drift',
        note: 'The same kernels read 184.7, 184.8, 216.6 and 255.5 ms on the Pascal; the graphics card\'s clock speed is the inferred cause, not measured.' },
    { id: 'reauthored', kind: 'unexplained', src: 'docs/PERFORMANCE.md', quote: '"in m, re-authored" -10.2%', ch: 'measure', title: 'one row always 10% fast',
        note: 'A scene re-authored in metres ran 10% faster than its neighbours on the same kernel text (23% on the Ampere): "Unexplained."' },
    { id: 'lt-fixed', kind: 'unexplained', src: 'roadmap/PLAN.md', quote: 'costs a fixed ~60 ms per sample', ch: 'caustics', title: 'light tracing\'s fixed 60 ms',
        note: 'With the learned map, whatever the photon count; another bench reads no cost at all.' },
    { id: 'data-9x', kind: 'unexplained', src: 'roadmap/ARCHITECTURE.md', quote: 'every data row is about 9 times', ch: 'codegen', title: 'the scene as data, 9 times slower',
        note: 'On the demo and the Menger cubes: "Why is not known."' },
    { id: 'cm-m', kind: 'unexplained', src: 'lib/pathtracer/PRECISION.md', quote: 'Why the conversion differs is open.', ch: 'precision', title: 'cm and m hit differently',
        note: 'About 2% of the camera\'s rays hit a part in cm that they pass in m (lavapipe).' },
    { id: 'sky-rows', kind: 'unexplained', src: T, quote: 'The two sky-only rows at 0.9993 are', ch: 'photometry', title: 'the sky reads 0.07% low',
        note: 'The one systematic remainder of the photometry test; the sky\'s own normalisation is "the first suspect".' },
    { id: 'metal-energy', kind: 'unexplained', src: 'roadmap/SURFACES.md', quote: 'the rows slightly CREATE energy, about one standard', ch: 'microfacets', title: 'metal makes 0.02-0.09% light',
        note: 'A small positive bias in the furnace, about one standard error a row; a fix is described, not built.' },

    /* DESIGNED, NOT BUILT */
    { id: 'pixel-tol', kind: 'designed', src: 'roadmap/PLAN.md', quote: '## A tolerance per pixel -- agreed 2026-10-02, the NEXT PR (designed, not built)', ch: 'precision', title: 'a tolerance per pixel',
        note: 'A finer tolerance where the camera looks closely: the user\'s "different eps for different pixels", agreed, built on the metres engine of 0.36.0.' },
    { id: 'thin-gaps', kind: 'designed', src: 'roadmap/PLAN.md', quote: '**Thin air gaps — open.**', ch: 'precision', title: 'thin air gaps',
        note: 'A gap under the probe\'s reach is jumped: two slabs 0.5 mm apart read as one (0.9228).' },
    { id: 'rough-dielectric', kind: 'designed', src: T, quote: 'compensation for dielectrics (Kulla-Conty\'s albedo tables, with transmission), not a fix.', ch: 'microfacets', title: 'rough glass\'s lost light',
        note: 'Rough glass loses the light that scatters more than once in its surface; closing that is a compensation still to build.' },
    { id: 'frosted-nee', kind: 'designed', src: 'roadmap/PLAN.md', quote: 'Rough transmission is still sampled and not evaluated, so NEE cannot', ch: 'microfacets', title: 'NEE through frosted glass',
        note: 'Rough transmission can be drawn but not evaluated, so a shadow ray cannot be weighed through frosted glass.' },
    { id: 'strat-pick', kind: 'designed', src: 'roadmap/PLAN.md', quote: '**Stratified source pick — not built**', ch: 'optics', title: 'a stratified source pick',
        note: 'Each LED\'s share of the rays is a random draw, the only reason a mix\'s colour is noisy (about 0.0012 in u\'v\'); picking by the ray\'s number would spread them evenly.' },
    { id: 'face-reflect', kind: 'designed', src: 'roadmap/PLAN.md', quote: '**A reflectance for a light\'s face — not built**', ch: 'emitters', title: 'a light face that reflects',
        note: 'A glowing face ends every ray, so light sent back onto an LED is lost.' },
    { id: 'volume-map', kind: 'designed', src: 'lib/pathtracer/README.md', quote: 'a volume photon map is the next phase', ch: 'haze', title: 'a photon map for dust',
        note: 'Light scattered in dust and seen through glass or in a mirror is found by chance, so it is noisy.' },

    /* A LIMIT, STATED */
    { id: 'finding-7', kind: 'limit', src: 'roadmap/PLAN.md', quote: '**The march tolerance makes every surface fatter by `eps`, and a small emitter brighter with it**', ch: 'precision', title: 'small lamps too bright',
        note: 'The tolerance fattens every surface, so a small glowing one sends too much light: chapter 30\'s 1 cm lamp and its pair, measured on the Ampere.' },
    { id: 'through-glass', kind: 'limit', src: 'lib/pathtracer/optics/README.md', quote: 'Still by chance: a light such a path can reach only through glass', ch: 'caustics', title: 'lights only through glass',
        note: 'A shadow ray stops at any surface, glass included, so a light reached only through glass is found by chance.' },
    { id: 'biases', kind: 'limit', src: 'roadmap/PLAN.md', quote: 'Shadow rays past `shadowcap` are dropped (dark)', ch: 'wavefront', title: 'the biases kept',
        note: 'Shadow rays past their cap dropped (dark), the last pass\'s shadow rays unblocked (bright), the bounce cap: each a bias the plan lists.' },
    { id: 'polarisation', kind: 'limit', src: 'roadmap/PLAN.md', quote: 'unpolarised Fresnel per interface is -0.3% on a slab\'s transmission at 45', ch: 'glass', title: 'no polarisation',
        note: 'Each face averages light\'s two polarisations: 0.3% off at 45 degrees, 3% at 70, as measured.' },

    /* FOUND BY THIS TUTORIAL: each a comment's own words, still there today, and the chapter that checks them. The
       twelve comments and document lines found with it were corrected in 0.67.3 (CHANGELOG.md); this one is code, the
       divisor itself, and whether to change it is the owner's call. */
    { id: 'twist-bound', kind: 'found', src: 'builder/modifiers.js', quote: "'warp(1.0 / sqrt(1.0 + rate * rate * extent * extent));'", ch: 'shapes', title: 'the twist\'s step bound',
        note: 'A twist divides the distance it steps by √(1 + c²), but a slanted move can stretch up to 15% more than that, so a step can run about 3% past a surface.' },
]

/** The items of one kind, or all of them ('all'), in the board's order */
export const itemsOf = kind => kind === 'all' ? ITEMS.slice() : ITEMS.filter(it => it.kind === kind)
/** How many of each kind */
export const counts = () => Object.fromEntries(KINDS.map(([k]) => [k, ITEMS.filter(it => it.kind === k).length]))
