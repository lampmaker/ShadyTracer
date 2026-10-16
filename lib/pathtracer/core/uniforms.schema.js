// 1) Uniform spec (keys match shader names)

// Split schema into logical groups matching menu folders
/* gui.showIf: { key: [values] } -- the control is shown only while that setting of the same group
   has one of the values (index.js addGroup applies it): the false-colour scale only in the
   false-colour views, the sun and sky only in sun and sky, the studio light only in the studio.
   gui.dev: a DEVELOPER SETTING -- one a user has no reason to move, kept for the bench and for
   diagnosis. Hidden from the panel unless its Developer switch is on (settingsui.js), and otherwise
   a setting like any other: RT.set takes it, the parameter registry lists it, a workspace saves it.
   NOT a missing gui block: that would make it plumbing everywhere -- the registry would drop it, and
   for a Lighting entry the builder's ENVIRONMENT (model.js) would refuse a scene that still has it.
   gui.help: what the setting does, in a sentence or two -- the row's tooltip in the Renderer panel and the
   Parameters panel's (settingsui.js, params.js). Taken off before Tweakpane sees the options, like the two above.
   gui.requires: [keys] -- settings that must be on (not 0) for this one to mean anything: the row is greyed and
   cannot be changed while one is off, and its tooltip says which (settingsui.js; the Performance box: the step cache's
   fill, cells and view without the cache). Taken off too.
   WHICH BOX OF THE RENDERER PANEL A SETTING IS IN is not here: settingsui.js RENDERER_BOXES lists that, since a
   group is a parameter's path (params.js GROUP_PARAMS) and moving a setting between groups would move its id. */
export const UniformGroups = {
  /* GROUPED BY HOW OFTEN YOU TOUCH THEM, not by what they technically are -- that is what
     decides which menu page a control lands on, and it is the whole point of the regrouping.
     Sampling is the quality-for-speed dials you drag while watching the image converge;
     Advanced is the things you set once and the diagnostics that only matter when something
     is wrong. Anything with no `gui` block is plumbing and gets no control at all. */
  Tracing: {
    /* HOW MUCH OF A PATH IS TRACED (quality.js, the Quality presets; materials_pbr.js FAST MODES).
       0, FULL: path tracing. 1, DRAFT: a camera path stops at the first diffuse or glossy surface
       it meets from outside, which gets the light arriving straight from the sun, the sky and the
       lamps (one shadow ray); mirrors, clear and frosted glass, near-mirror metal are followed. No
       bounce light, so shade is darker than in full; light tracing still brings what passes through
       glass. 2, SKETCH: the same stop, a fixed light and no shadow rays, for shape alone. 3, OPTICS:
       Sketch's camera paths, and the lights' rays traced through mirrors, glass and gloss to the
       first diffuse surface they reach, where they light the picture and end -- the optics without
       the room's bounce light (materials_pbr.js FAST MODES). The
       measuring views ignore it and trace in full (quality.js effective): a lux reading must not be
       quietly the direct light only. The panel's Quality row is its control (settingsui.js). */
    renderMode: { type: 'u32', def: 0, gui: { label: 'Light paths', options: { 'full': 0, 'draft (direct light)': 1, 'sketch (flat light)': 2,
                                                                               'optics (light rays, flat light)': 3 } } },
    /* WHILE MOVING (0.59.0; the user, 2026-10-11: "when panning / moving the viewport, objects etc ... switch back to the
       selected preview mode"): a full picture traces as moveMode while the camera, a drag or a live value moves, and
       comes back once it stops (quality.js effective, interaction.js). The view's ⚡ is moveFast; its Quality menu has
       both. Host-side: no shader reads them, and no preset names them, so choosing a preset leaves them as they are. */
    moveFast: { type: 'u32', def: 1, gui: { label: 'Fast while moving', min: 0, max: 1, step: 1,
        help: 'While the camera, an object or a value is being moved, a Standard, High or Custom picture is traced as Draft'
            + ' or Sketch (the row below), and the full picture comes back a moment after it stops. Draft, Sketch and Optics'
            + ' stay as they are. The view\'s \u26a1 button.' } },
    moveMode: { type: 'u32', def: 1, gui: { label: 'Fast while moving: as', options: { 'Draft (direct light)': 1, 'Sketch (flat light, fastest)': 2 },
        requires: ['moveFast'],
        help: 'What a move traces: Draft keeps the light and the shadows, so the picture changes less when it stops; Sketch'
            + ' is the lightest, for a heavy scene.' } },
    /* LENGTHS HERE ARE IN METRES, whatever unit the scene is modelled in: the engine works in
       metres since 0.36.0 and uses them as they are; only the scene's own code sees them in its
       unit, through the boundary (scene_api.js SCENE_BOUNDARY). lib/pathtracer/PRECISION.md has
       which side is in which unit, and why the unit changes no precision. See
       core/photometry.js for why the unit is plumbing for everything that is not a length. */
    /* 0 = AUTOMATIC: a share of the scene's size (photometry.js autoEps) -- 1 mm for a room,
       microns for an LED optic. A fixed 1 mm was the default, and a scene a few centimetres big
       rendered wrongly with it: the offset off a surface (10x eps) went straight through a lens.
       Any other value is a length in metres that overrides it. Either way never finer than f32
       can resolve where it is used (core/tolerances.js marchTol's floor); Render stats and
       RT.tolerances() say what is in use. */
    /* ITS STEP IS 1 nm. It was 1e-5 (10 um), and a step is a constraint, not a nudge: Tweakpane rounds what is typed to a
       multiple of it (tweakpane StepConstraint), so 0.000001 became 0 -- automatic -- and nothing finer than 10 um could
       be set from the panel, where the RGBW mixer's automatic one is 10.5 um. The Renderer panel shows it in um
       (settingsui.js RENDERER_BOXES, a row's `scale`); stored, saved and set from a script it stays metres.
       A BOX TO TYPE INTO, NO RANGE (the user, 2026-10-08: "dont make it a slider, just a number I can type in. so no
       min/max"). It was a slider from 0 to 0.5 m -- 0 to 500 000 um on the panel, where a few um could not be dragged
       to. Tweakpane makes a slider only from a min AND a max (tweakpane DefiniteRangeConstraint); a MIN ALONE is a box
       unbounded above. The min stays because NEITHER is worse: the PropertyTable then makes up a range of its own, 0 to
       100 (propertytable.js bindingPrepper), and 2000 um typed became 100. 0 is automatic anyway (tracebasics.js
       tolSetting, core/tolerances.js: both ask eps > 0). */
    eps: { type: 'f32', def: 0, gui: { label: 'Surface tolerance (m, 0 = auto)', min: 0, step: 1e-9, dev: true } },
    maxiter: { type: 'u32', def: 400, gui: { label: 'Max Iterations', min: 1, max: 2000, step: 1, dev: true } },
    stepscale: { type: 'f32', def: 0.9, gui: { label: 'Step Scale', min: 0.1, max: 1, step: 0.01, dev: true } },
    maxbounce: { type: 'u32', def: 10, gui: { label: 'Max Bounces', min: 1, max: 40, step: 1,
        help: 'How often a path may scatter before it ends. More lets light go further round a room or down a long chain'
            + ' of glass; each bounce is another step of every path still going.' } },
    /* Russian roulette: unbiased early termination of low-throughput paths after uRRStart
       bounces. Same expected image, fewer rays.
       The theory won. An earlier reading had it brightening the image 6-8%, which was the
       adaptive iteration budget confounding the comparison rather than a bias; measured
       again with the budget pinned off, all four arms agree within 0.15%. DEFAULTS OFF
       only because it buys nothing here -- +0.9% ms/sample, inside the noise -- since a
       drained wavefront iteration still costs its dispatches. See core/tracebasics.js. */
    rr: { type: 'u32', def: 0, gui: { label: 'Russian Roulette', min: 0, max: 1, step: 1, dev: true } },
    /* Next-event estimation with MIS: sample the environment directly at every bounce -- half
       the samples on the solar disc, half cosine-weighted for the sky -- and weight it against
       BSDF sampling with the power heuristic. Costs one shadow ray per bounce, through the
       occlusion queue in wavefront.js. */
    nee: { type: 'u32', def: 1, gui: { label: 'Next-Event Estimation', min: 0, max: 1, step: 1, dev: true,
        help: 'Light sampling: at every bounce one shadow ray towards a light -- the sun, the sky, a light\'s face, a glowing'
            + ' surface -- weighed against the bounce by MIS. Off only to compare: every light is then found by chance.' } },
    /* LIGHT TRACING, for caustics: photons from the solar disc through glass and mirrors,
       connected to the camera at the first surface that scatters them. The camera side then
       stops counting the sun along exactly those paths, so the total is unchanged and only
       the noise moves -- see LIGHT TRACING in materials_pbr.js. ON BY DEFAULT since the lt
       bench held meanLuma to 0.03% in every combination with NEE (Ampere, showcase) and the
       user saw caustics in all four. It pairs with NEE: light tracing does the glass, NEE the
       direct sun -- with NEE off the caustics stay clean but direct sun is noisy again. */
    // not in Sketch, which traces no light, nor in Optics, whose light is the lights' alone (quality.js effective)
    /* "CAUSTICS (SUN, GLOWING SURFACES)", once "Light Tracing (caustics)": the lights' photons are light tracing too, and
       they do not stop when this is off -- lightRays below is theirs. A label that named the technique hid that
       there were two switches (the user, 2026-10-04: the settings were "too hard to find (and understand)"). */
    lt: { type: 'u32', def: 1, gui: { label: 'Caustics (sun, glowing surfaces)', min: 0, max: 1, step: 1, showIf: { renderMode: [0, 1] },
        help: 'Photons from the sun and from glowing surfaces, traced through glass and mirrors to the first surface that'
            + ' scatters them: their caustics. Off, the camera\'s paths count that light themselves, far more noisily.' } },
    /* THE LIGHTS' RAYS IN THE PICTURE: whether the photons of the other modules' sources run (R.photonSources -- in
       the raytracer, the optics module's: the scene's light objects, ray files among them). Until 0.16.0 nothing
       turned them off: `lt` read as the light tracing switch and left them running. HOST-SIDE ONLY: raytrace_main.js
       asks every photon source for none when it is 0, as Sketch does; no shader reads this name. Without those
       photons ltLights is 0 and the camera's paths count every light's face themselves (codegen LIGHTS) -- the
       state the picture is already in while their kernel compiles or the ray buffer has no room for them -- so the
       picture stays right where a face can be seen and is noisier through glass. A light with no face to see -- a
       point, a ray file, a collimated beam past its first hit (codegen LIGHTS) -- lights nothing without them.
       In STANDARD (quality.js), as lt is: off is less than the full picture. */
    lightRays: { type: 'u32', def: 1, gui: { label: 'Lights\' rays (light objects)', min: 0, max: 1, step: 1, showIf: { renderMode: [0, 1, 3] },
        help: 'The light objects\' photons -- LEDs, panels, ray files -- traced through lenses, mirrors and glass to what'
            + ' they light. Off, the camera\'s paths count a light\'s face themselves: noisier through glass, and a point,'
            + ' a ray file or a collimated beam lights nothing.' } },
    /* Photons per sample, per pixel of the picture. They share the ray budget with the camera
       rays and cost about as much each; a caustic's noise falls with this. THE LIGHTS' PHOTONS ARE
       COUNTED BY IT TOO (optics/index.js, the picture source's perPixel), whatever lt says -- so it
       shows wherever either runs: not with lt alone, which hid the lights' count when the sun's
       caustics were switched off, and in the Optics view, where the lights' rays are all there is. */
    ltPhotons: { type: 'f32', def: 1.0, gui: { label: 'Photons per Pixel', min: 0.05, max: 4, step: 0.05, showIf: { renderMode: [0, 1, 3] },
        help: 'Photons each sample, per pixel of the picture, for each of the two above that is on: more is a quieter'
            + ' caustic and a slower sample.' } },
    /* THE PHOTON MAP (0.60.0; core/sppm.js): photons that have passed glass or a mirror are stored where they land, and the
       camera's rays that reach a surface through glass or a mirror gather them there -- the floor behind a glass slab,
       lit through it and seen through it, which until 0.60.0 came only by chance (the lens's photons, removed with the
       manifold connection in 0.61.0: the map owns that light). A sample then traces its photons first and its camera
       rays after (photons.js planBatches's `first`), so it costs a second wavefront chain a sample, and the map's memory
       (sppmCapacity). In Draft and Optics too: their camera paths end where they gather, and the map adds the light
       through glass nothing else there counts (Optics: the lights' rays). ON BY DEFAULT since 0.61.0, after the user saw
       it on their card ("this looks really good"; its cost a sample still unmeasured), with the idle skip: a view where
       no camera ray gathers runs without it (raytrace_main.js sppmIdle). A build: the kernel prog_sppm exists only while
       this is on (raytrace_main.js kernelOptionsOf). */
    sppm: { type: 'u32', def: 1, gui: { label: 'Seen through glass and mirrors (photon map)', min: 0, max: 1, step: 1, showIf: { renderMode: [0, 1, 3] },
        help: 'Light that has passed glass or a mirror, landing on a surface seen through glass or in a mirror -- a floor'
            + ' behind a glass pane, lit through it -- gathered from the photons that landed there, so it shows at once.'
            + ' A little blurred at first, sharper as samples come in. Off, that light is missing. Needs the caustics or'
            + ' the lights\' rays. Switching it compiles a kernel and takes memory for the photons; a view with nothing'
            + ' seen through glass or a mirror skips it.' } },
    /* ...ITS RADIUS AT THE FIRST SAMPLE, in pixels at the distance in focus (camLens.y; the target's, with no focus set):
       sppm.js sppmRadius shrinks it every sample after. 3 is a choice made without seeing it. Host-side: sppmGeom. */
    sppmRadius: { type: 'f32', def: 3, gui: { label: 'Photon map: radius (pixels)', min: 0.5, max: 20, step: 0.5, dev: true, requires: ['sppm'],
        showIf: { renderMode: [0, 1, 3] },
        help: 'How far round a point the photon map gathers at the first sample, in pixels at the distance in focus; it'
            + ' shrinks every sample after. Larger is smoother and blurrier at first.' } },
    /* ...AND HOW MANY PHOTONS IT HOLDS, in millions: 44 bytes each (sppm.js SPPM_REC, 0.61.3), two million 88 MB. A sample
       that would ask more keeps each of its stores with the probability that fits, its power over it: exact, noisier
       (sppm.js NEITHER FULL NOR CUT; until 0.61.3 the rest were dropped, and the light through glass read dark). Only a
       sample asking more than the one before can still overfill it: dropped and counted (Render stats). Host-side: the
       buffer's size. */
    sppmCapacity: { type: 'f32', def: 2, gui: { label: 'Photon map: photons (millions)', min: 0.25, max: 16, step: 0.25, dev: true, requires: ['sppm'],
        showIf: { renderMode: [0, 1, 3] },
        help: 'How many photons the map holds a sample, in millions (44 bytes each). A sample with more keeps a share of'
            + ' them, each weighed up to match: the same picture, noisier. Render stats says what share it kept.' } },
    /* THE OPTICS VIEW'S FLAT LIGHT (renderMode 3), in stops from Sketch's: 0 is Sketch's own level
       (the lux the scene's environment puts on a level surface, photometry.js derive), each stop down
       halves it, so a beam dimmer than the daylight can be brought out of the flat shading; the
       leftmost, OPTICS_FLAT_OFF, is no flat light at all -- the lights alone, which is also what the
       optics-mode bench row reads against a closed form. Host-side: it scales UB.sketchE.
       IT STARTS 4 STOPS DOWN, a choice made without seeing it: at Sketch's own level under the default
       sun and sky (about 86 000 lx on a level surface) a 100 lm LED's spot a few centimetres across
       is of the same order and barely shows; auto-exposure makes only the ratio matter. */
    opticsFlat: { type: 'f32', def: -4, gui: { label: 'Flat light (stops, -12 = off)', min: -12, max: 0, step: 0.5, showIf: { renderMode: [3] } } },
    /* Half-size of the square, through the origin and facing the sun, that photons cross the
       scene through. AN EFFICIENCY SETTING ONLY: the camera side keeps every path whose line
       misses the square (THE EMISSION FRAME in sdf.js), so glass outside it is not lost, just
       left noisy. And within it the emission map learns where the glass is, so generous is
       cheap. 15 covers the showcase scene's 20 x 20 ground plane. Its own number, never
       envRadius -- one uniform meaning two things is how guideExtent's first version went
       wrong. */
    /* 1 = the emission map learns where the glass is (prog_lt_build); 0 = photons stay uniform
       over the square. A switch so the bench can A/B the learning itself -- both settings must
       give the same meanLuma, and the difference in noise is what the learning is worth. */
    ltLearn: { type: 'u32', def: 1, gui: { label: 'Learn Photon Map', min: 0, max: 1, step: 1, dev: true } },
    /* A CAP, NEVER WIDER THAN THE SCENE'S RADIUS (0.9.1; DERIVED ltHalf, photometry.js photonHalf): a 25 cm
       scene in a 15 m square got a few cells of the learned map. The kernels read ltHalf, never this. */
    ltRadius: { type: 'f32', def: 15.0, gui: { label: 'Photon Area half-size (m)', min: 0.5, max: 200, step: 0.5, dev: true } },
    /* EMISSIVE SURFACES AS LIGHTS. Half-size of the cube, centred on the origin, over which
       emitters are discovered (a 16^3 grid of voxels, each keeping the tight box of the
       emitter hits inside it). Emitters outside it are still counted, by the paths that hit
       them -- they are just never aimed at. Its own number, like ltRadius. */
    // ...and capped by the scene's radius like ltRadius (DERIVED emitHalf), which is what the kernels read
    emitRadius: { type: 'f32', def: 15.0, gui: { label: 'Emitter search half-size (m)', min: 1, max: 200, step: 0.5, dev: true } },
    /* HOW FAR PAST ITS HITS AN EMITTER IS AIMED AT (prog_emit_collect): the sphere NEE and the emitter probes
       aim at is the tight box of the camera's hits on it, plus this. 0 = AUTOMATIC, the step off a surface
       (offsetEps, 10x the march tolerance): a hit is within one tolerance of the surface, so that covers it.
       It was a fixed 2 cm -- a room's number: round a 1 cm emitter, a sphere four times its size, most of
       whose cone missed it (PLAN.md L5). Exact at any value (emitCovers: the camera side keeps what no probe
       could reach); a setting so the bench can put the old 2 cm back beside the new (small-emitter). */
    emitMargin: { type: 'f32', def: 0, gui: { label: 'Emitter aim margin (m, 0 = auto)', min: 0, max: 0.1, step: 0.0001, dev: true } },
    /* Share of light samples (NEE) aimed at discovered emitters rather than the sun and sky,
       once anything has been discovered. */
    neeEmitShare: { type: 'f32', def: 0.5, gui: { label: 'NEE emitter share', min: 0.05, max: 0.95, step: 0.05, dev: true } },
    /* Share of light-tracing photons started on emitters rather than from the sun, when both
       have light to give. */
    ltEmitShare: { type: 'f32', def: 0.5, gui: { label: 'Photons from emitters (share)', min: 0.05, max: 0.95, step: 0.05, dev: true } },
    /* DRAFT'S SEEK RAYS: the share of the paths Draft stops that go one segment further, carrying
       nothing, only to find lamps (materials_pbr.js FAST MODES). Emitters are discovered by the
       camera paths that hit them, and a Draft path that stops at the wall a hidden lamp lights
       would otherwise never find it -- the wall stays dark. A setting so the bench can turn them
       off and show what they are for (render-modes, the disc light); 0 is off. */
    draftSeek: { type: 'f32', def: 0.125, gui: { label: 'Draft: rays that look for lamps (share)', min: 0, max: 1, step: 0.025, dev: true } },
    /* THE AVERAGING WINDOW, 0 = the true mean: every sample since the last change counts. It was 10
       by default, an EMA worth about 21 samples, "so an interactive view forgets the frames from
       before the camera moved" -- which a move no longer needs, since it restarts the picture
       (moveAverages 0), as every edit does. What the 10 still did was stop a still view from ever
       converging: invisible under the tone curve, and plain in the false colour, where every pixel
       kept flickering between bands (the user, 2026-09-28). A window is still a choice. */
    maxaverages: { type: 'u32', def: 0, gui: { label: 'Max Averages (0=unlimited)', min: 0, max: 100, step: 1, dev: true } },
    /* HOW MUCH OF THE OLD PICTURE A RESET KEEPS, in samples. 0 -- the default -- restarts: the
       first sample after a move replaces every pixel it lands on. N keeps a window of N, so the
       picture blends through a move instead of dropping to one noisy sample, and the old view
       fades as about N / (N + n) after n samples. That fade is the price: it is what used to be
       hard-wired at 2, and in cd/m^2 a highlight from before the move (1e9 against a white
       point of 4e4) stays visible as a trail for a long time. A choice, so a setting. Host-side
       only -- it sets the window R.trace hands resolve; no shader reads it. */
    moveAverages: { type: 'u32', def: 0, gui: { label: 'Keep on move (samples, 0=restart)', min: 0, max: 32, step: 1, dev: true } },
    /* THE ONE KNOB THAT BIASES ON PURPOSE. A cap on what a single path, shadow ray or photon
       connection may add to a pixel, IN MULTIPLES OF THE DISPLAY WHITE (the luminance the
       exposure maps to 1.0; UB.fireflyWhite) -- 0 is off, and off is the default, because a
       physically correct picture and a measurable one both need every path's full weight. What
       the camera sees directly (a lamp, the sky) is never capped. It used to be a hard 1e4 in
       tracebasics.js, then a cap in cd/m^2 -- which darkened every sunlit surface (~2e4 cd/m^2
       from one light sample) at any value that touched fireflies, and gave a flat, dim picture.
       Around 4-16 keeps the tone curve's highlights and takes out the speckles. BELOW 1 IT
       FEEDS BACK: auto-exposure meters the clamped picture, so capping ordinary pixels brightens
       the exposure, which lowers the cap -- so the shader never caps below 1x white. */
    fireflyClamp: { type: 'f32', def: 0, gui: { label: 'Firefly clamp (\u00d7 display white, 0=off)', min: 0, max: 64, step: 0.5,
        help: 'A cap on what one path may add to a pixel, in multiples of the display white: takes out the speckles, and'
            + ' darkens the picture a little on purpose. 0, off, is the physically correct picture.' } },
    /* LAMPS ONLY: the view lit by the scene's own emitters, with the sun, the sky and the studio
       light off. A RENDERER SETTING, not the scene's: the scene keeps its environment (the builder's
       Environment row, model.js ENVIRONMENT) and gets it back when this is off. Host-side only --
       quality.js effective zeroes the environment's illuminances in the bag the kernels get, and no
       shader reads this name. For judging a lamp without the daylight drowning it. */
    lampsOnly: { type: 'u32', def: 0, gui: { label: 'Environment light', options: { "the scene's": 0, 'off (lamps only)': 1 },
        help: 'The scene\'s sun and sky or studio light (its Environment row). Off: lit by its own lights and glowing'
            + ' surfaces alone; the scene keeps its environment.' } },
  },

  /* Set-once switches and diagnostics -- every one a developer setting (gui.dev), so the whole
     folder ("Normals and diagnostics") goes with the Developer switch. fastnormals is here rather than on the main page
     because the measurement settles it: turning it off costs 4.3x the entire frame
     (cost-sweep, Pascal), so it is not a dial, it is a debug switch with one sane value. */
  Advanced: {
    fastnormals: { type: 'u32', def: 1, gui: { label: 'Fast Normals (off = 4.3x slower)', min: 0, max: 1, step: 1, dev: true } },
    normallimit: { type: 'f32', def: 1.0, gui: { label: 'Normal Limit', min: -1, max: 1, step: 0.01, dev: true } },
    /* NO `cull` ANY MORE (0.34.0; the user, 2026-10-07: "yes, make dear-only the default and remove the setting"). It was
       "Skip far objects (bounding boxes)", on by default: every top-level node's box tested, or none (a generation option
       since 0.29.0, codegen.js emitScene `cull`; no shader read the uniform). The builder now tests a box only where a node
       is dearer than it (codegen.js, ONLY THE DEAR ONES), measured twice in Tests > boxcost; every box and none are the
       bench's alone. A saved workspace that has it opens with a console line naming it ignored (index.js applySettings
       returns it as unknown; index.html says so). */
    /* THE BAKE IN THE BACKGROUND (builder/baker.js, bake.js; 0.31.0): once the edits stop, the builder's
       scene with every value a constant is compiled while the picture goes on and swapped in when ready, the picture
       kept; the first edit puts the editing build back, from the pipeline cache. Measured on the user's Pascal (0.28.1):
       the baked march 16 to 68% faster than codegen's on seven of the eight bench scenes. Host-side only.
       ON BY DEFAULT since 0.35.0 (the user, 2026-10-07: "make bake default on"), once the lights' photons stopped going
       out at its swap (0.34.2). A saved workspace keeps what it saved: every value is (index.js settings()). */
    sceneBake: { type: 'u32', def: 1, gui: { label: 'Bake when the edits stop', min: 0, max: 1, step: 1, dev: true,
        help: 'Once nothing has been edited for two seconds, the scene is compiled again in the background with every value'
            + ' written into the kernels as a constant -- faster to render (the march 16 to 68% faster on seven of the eight'
            + ' bench scenes, measured on a GTX 1080 Ti) -- and swapped in when it is ready, the picture kept. The first edit'
            + ' after puts the editing build back at once, from the cache. Works with the scene as data or as code.' } },
    /* A SAMPLE OVER SEVERAL FRAMES (raytrace_main.js R.trace's `slice`; 0.58.0): the GPU milliseconds the live view
       hands the card a frame. A sample slower than this is cut into batches, a few a frame, and resolved when the last
       is done, so the browser gets the GPU back between them and the page stays usable on a heavy scene (the user,
       2026-10-10: "when renders take very long the whole UI becomes unresponsive"). A faster sample is not cut, and a
       frame holds no more of them than fit. 0: whole samples, a frame at least one, as before. The live loop's only:
       a save, Tests and RT.step trace whole samples whatever this says. Host-side: no shader reads it. */
    sliceMs: { type: 'f32', def: 30, gui: { label: 'GPU time a frame (ms, 0 = whole samples)', min: 0, max: 500, step: 5, dev: true,
        help: 'Keeps the page responsive on a heavy scene. A sample that takes the GPU longer than this is split into'
            + ' pieces, a few each frame, and added to the picture when its last piece is done -- so the browser can draw'
            + ' between them, and the picture updates once a sample instead of the whole page waiting for it. A faster'
            + ' sample is not split. 0: every frame at least one whole sample, as before. The live view only: Save an'
            + ' image and Tests always trace whole samples.' } },
    /* THE SCENE AS DATA (builder/scenedata.js, PERFORMANCE.md P3): the builder's scenes as records
       one evaluator walks, so an edit that adds no code -- a node added, deleted, moved, given another material --
       writes a buffer instead of compiling. Off: every node its own code, as before. A developer's until the bench says
       it is not slower (PERFORMANCE.md call 5); on a device with only the spec's 8 storage bindings a stage it stays
       off, since shade needs a ninth for the scene's buffer. Host-side only: the builder reads it, no shader does. */
    sceneData: { type: 'u32', def: 0, gui: { label: 'Scene as data (edits without a compile)', min: 0, max: 1, step: 1, dev: true,
        help: 'The builder\'s scene as records that one walk reads, not as code: an edit that adds no code -- an object added,'
            + ' moved, deleted, given another material -- writes a buffer instead of compiling. Off, every object is its own code'
            + ' (codegen), and every structural edit compiles. Turning it builds the scene again.' } },
    /* NO `sceneGrid` OR `sceneExact` ANY MORE (0.41.0; the user, 2026-10-08: "Remove the exact hits code. Remove the
       candidate grid"). Both were the scene as data's, developer switches: a grid naming the solids each point needs, and
       answers along the ray for the closed-form shapes. Measured on the user's Pascal (Tests > builds, 0.32.0 and
       0.33.1; Tests > scenedata, 0.21 to 0.22): faster than the baked build on one scene of eight (Surface materials),
       12 to 30 times codegen's march on the demo and the Menger cubes, the grid slower than none on four of seven
       (roadmap/ARCHITECTURE.md, Removed in 0.41.0). A saved workspace that has them opens with a console line naming them
       ignored, as `cull` (index.js applySettings). */
    /* THE STEP CACHE (wavefront.js stepCacheWGSL; roadmap/ARCHITECTURE.md, A lazy step cache): a grid over the scene's
       box, each cell filled by a pass of its own with the scene's distance at its centre -- an empty ball -- and a later
       step inside a ball taken to where the ray leaves it, with no SDF. 1: the ball of the cell the ray is in; 2: the
       farthest exit among that one's and the two cells' ahead along the ray. Codegen or data alike: it is in the march and
       occlusion kernels, not the scene. Off until Tests > stepcache says it pays; inert without a box (setStepCacheBox).
       A KERNEL OPTION since 0.29.0 (raytrace_main.js R.kernelOptions): compiled into those kernels only when on, so a
       change is a build of them (index.js syncKernels), and off they hold none of it. No shader reads the uniform. */
    stepCache: { type: 'u32', def: 0, gui: { label: 'Step cache (0 off, 1 own cell, 2 cells ahead)', min: 0, max: 2, step: 1, dev: true,
        help: 'Cells over the scene, each keeping the distance to the nearest surface from its centre, filled before the trace:'
            + ' a step inside one jumps to where the ray leaves that empty ball, without evaluating the scene. 1: the cell'
            + ' the ray is in; 2: the two ahead along it too. Built into the march only while on: turning it rebuilds those'
            + ' kernels. Works with code and data alike.' } },
    /* ...HOW OFTEN ITS CELLS ARE FILLED, by a pass of their own before the trace (wavefront.js prog_stepcache_fill: the
       distance without the bounding boxes, so no ball stops at one), after which the march and occlusion kernels only
       read them: 1 when what they were filled for changes (raytrace_main.js R.stepCacheFor); 2 before every trace --
       what a live drag pays at every frame, for the bench to time. The same kernels either way: host-side only.
       NO 0 SINCE 0.41.0 (the user, 2026-10-08: "Remove the stepcache 0 option"): the march's own fill on a ray's first
       visit, which filled once beat on every scene of the user's Pascal (Tests > stepcache, 0.33.1: 6 to 22%). A saved
       0 fills as 1: only 2 differs (R.stepCacheFor). */
    stepCacheFill: { type: 'u32', def: 1, gui: { label: 'Step cache: fill (1 when the scene changes, 2 every frame)', min: 1, max: 2, step: 1, dev: true, requires: ['stepCache'],
        help: '1: every cell filled by a pass of its own whenever the scene changes, then only read while tracing -- the'
            + ' distance without the bounding boxes, so no ball stops at a box. 2: that pass before every frame, to time what'
            + ' a live edit pays. Needs the step cache.' } },
    /* ...ITS CELLS, in millions over the box (raytrace_main.js R.stepCacheCellsOf; 4 bytes a cell). Finer cells help
       closer to surfaces but cost a longer fill pass and more memory; coarser ones the other way round -- which wins is the card's to say (Tests > stepcache, its 1, 4 and 16 million rows). A
       change cuts the box again, empty. Host-side only: the renderer reads it, no shader does. */
    stepCacheCells: { type: 'f32', def: 4, gui: { label: 'Step cache: cells (millions)', min: 0.25, max: 16, step: 0.25, dev: true, requires: ['stepCache'],
        help: 'How many cells the step cache cuts the scene\'s box into, in millions, 4 bytes each. Finer cells help closer to'
            + ' surfaces but cost a longer fill and more memory. Needs the step cache.' } },
    /* ...AND ITS CELLS SHOWN over the picture (rendertoscreen.js STEP_CACHE_VIEW_WGSL): each filled cell a little fog
       along the camera's rays where its ball is smaller than the cell (near a surface: the cache cannot help there); a cell
       whose ball reaches past it is clear (0.32.2: it was green, and the filled volume hid everything). A kernel option as
       the cache is (0.29.0): the display pass is built with the walk only while this and the cache are on. Switching it
       does not empty the cells it is there to show (raytrace_main.js R.stepCacheFor). */
    stepCacheView: { type: 'u32', def: 0, gui: { label: 'Step cache: show its cells', min: 0, max: 1, step: 1, dev: true, requires: ['stepCache'],
        help: 'The cells near surfaces drawn over the picture as orange fog: filled, but their ball is smaller than the cell,'
            + ' so a ray there still asks the scene. Cells whose ball reaches past them -- where a step is free -- are clear,'
            + ' as are empty ones. Needs the step cache.' } },
    /* NEE SUN/SKY SPLIT. Share of light samples spent on the solar disc rather than the sky. A uniform rather
       than a constant because it SPLITS THE TWO HALVES OF THE LIGHT STRATEGY, and right now
       that is the only way to find out which of them is wrong: NEE is clean at the default
       sun and 76% too bright at 20x, so the error is in the disc, not the sky. 1.0 samples
       only the disc, 0.0 only the sky (the disc is then found by chance through the cosine
       lobe, which is unbiased but noisy). Both extremes must agree with NEE off. */
    neeSunPick: { type: 'f32', def: 0.5, gui: { label: 'NEE sun/sky split', min: 0, max: 1, step: 0.05, dev: true } },
    /* A TEST ENVIRONMENT: one luminance (cd/m^2) in every direction instead of sky and sun -- a
       white furnace, in which an albedo-1 material must be invisible (see the furnace bench). 0 is
       the real sky. The sun is off while it is set (photometry.derive), and so light tracing. */
    envUniform: { type: 'f32', def: 0, gui: { label: 'Uniform environment (cd/m\u00b2, 0 = sky; test)', min: 0, dev: true } },
    /* ALWAYS 0, and nothing sets it: a number the shader compiler cannot see. noUnroll(n)
       (tracebasics.js) adds it to a loop bound so the compiler cannot unroll the loop -- which,
       around a call to the scene's SDF, is the difference between one copy of the scene in a
       kernel and thirty-two. No control: plumbing. */
    opaqueZero: { type: 'u32', def: 0 },
  },

  Lighting: {
    /* WHICH ENVIRONMENT. 0, the physical sun and sky below. 1, STUDIO: a soft, even light from
       every direction, brighter from above -- quick to converge (no sun to find, nothing to
       normalise) and even enough to judge shapes and materials by. Its luminance is
       L(d) = L0 (1 + top d.z), so `studioTop` 0 is perfectly flat and 1 is black straight down;
       L0 is derived so a level surface facing up receives exactly studioIlluminance lux, whatever
       top is (photometry.studioLuminance). The colour is a tint, normalised to luminance 1, so
       it does not change the lux either. The sun is off in it, and so the sun's light tracing. */
    // A LABEL NEVER REPEATS ITS GROUP'S NAME: it sits under it (the Environment panel, the Parameters
    // panel's headings), and 'Environment' inside Environment said it twice. So: Source, Mode, EV100.
    envMode:           { type: 'u32', def: 0,     gui: { label: 'Source', options: { 'sun & sky': 0, 'studio (uniform)': 1 } } },
    studioIlluminance: { type: 'f32', def: 1000,  gui: { label: 'Studio (lx, horizontal)', min: 0, showIf: { envMode: [1] } } },
    studioColor:       { type: 'vec3<f32>', def: { r: 1, g: 1, b: 1 }, gui: { label: 'Studio colour', color: { type: 'float' }, showIf: { envMode: [1] } } },
    studioTop:         { type: 'f32', def: 0.5,   gui: { label: 'Studio top light (0 = flat)', min: 0, max: 1, step: 0.01, showIf: { envMode: [1] } } },
    /* PHYSICAL UNITS -- see core/photometry.js. The sun is given by the illuminance it puts on a
       surface facing it (direct normal illuminance) and its angular size, and the disc's luminance
       is derived from both, so a bigger sun is a softer shadow and not a brighter picture. The sky
       is given by the illuminance it alone puts on a horizontal surface, and prog_skynorm scales
       whatever the scattering model produces to exactly that. Defaults are a clear day with the sun
       at 45 degrees: about 100 klx direct and 15 klx diffuse.
       The old trio -- uSunIntensity, a disc radiance of 1 at a half-angle uSunSize of 0.1 rad (21x
       the real sun), and uSkyIntensity, a multiplier on a sky calibrated to look like the one
       before it -- had no units, and the sun delivered 3% of the sky's light. */
    sunIlluminance:    { type: 'f32', def: 100000, gui: { label: 'Sun (lx, direct normal)', min: 0, showIf: { envMode: [0] } } },
    sunDiameter:       { type: 'f32', def: 0.53,   gui: { label: 'Sun diameter (deg)', min: 0.1, max: 30, step: 0.01, showIf: { envMode: [0] } } },
    skyIlluminance:    { type: 'f32', def: 15000,  gui: { label: 'Sky (lx, horizontal)', min: 0, showIf: { envMode: [0] } } },
    uSunAzimuth:       { type: 'f32', def: 45.0,  gui: { label: 'Sun Azimuth', min: -180, max: 180, step: 1, showIf: { envMode: [0] } } },
    uSunElevation:     { type: 'f32', def: 45.0,  gui: { label: 'Sun Elevation', min: -90, max: 90, step: 1, showIf: { envMode: [0] } } },
    uSkyTurbidity:     { type: 'f32', def: 0.7,   gui: { label: 'Sky Turbidity', min: 0, max: 10, step: 0.01, showIf: { envMode: [0] } } },
    /* NO envRadius HERE ANY MORE: it is the scene's (DERIVED below, from scene.envRadius). */
  },
  Exposure: {
    /* EV100, as a camera means it: 15 is a sunlit scene, 12 overcast, 7 an office, 2 a candle-lit
       room. It replaces a linear multiplier of 2.2 and a gamma of 1.0 -- which together were a
       picture with no sRGB encoding, tuned by eye to a sky of arbitrary brightness. The display now
       divides by the luminance that clips at this EV and encodes to sRGB; see rendertoscreen.js. */
    exposureEV:        { type: 'f32', def: 15,    gui: { label: 'EV100 (manual)', min: -6, max: 20, step: 0.1 } },
    /* AUTO-EXPOSURE, on by default: the GPU meters the accumulated picture every frame (a log-
       luminance histogram, the middle 10-90% averaged in log space -- core/autoexposure.js) and
       eases the exposure towards what a reflected-light meter would read. Off, exposureEV rules.
       Compensation is in stops, + is brighter, and applies to auto only -- manual already IS
       the number. Speed is the share of the gap closed per frame: 1 jumps, 0.05 drifts. */
    autoExposure:      { type: 'u32', def: 1,     gui: { label: 'Auto exposure', min: 0, max: 1, step: 1 } },
    exposureComp:      { type: 'f32', def: 0,     gui: { label: 'Compensation (EV)', min: -5, max: 5, step: 0.1 } },
    aeSpeed:           { type: 'f32', def: 0.1,   gui: { label: 'Auto exposure speed', min: 0.01, max: 1, step: 0.01 } },
    aeHeadroom:        { type: 'f32', def: 2,     gui: { label: 'Highlight headroom (EV)', min: 0, max: 12, step: 0.5 } },
    /* THE TONE CURVE, between exposure and the sRGB encoding. 0 = none: above white clips, the
       way the display has always worked. 1 = Khronos PBR Neutral: linear up to 0.76 of white,
       then a compression that keeps hue -- colours stay what they are, which is what a physical
       renderer should show by default. 2 = AgX: a filmic curve that desaturates towards white,
       the look of a camera rather than of a colour chart. See rendertoscreen.js. */
    toneMap:           { type: 'u32', def: 1,     gui: { label: 'Tone curve', options: {
        'none (clip)': 0, 'PBR Neutral': 1, 'AgX': 2, 'AgX punchy': 3, 'ACES (fitted)': 4, 'Reinhard': 5, 'Hable filmic': 6 } } },
    contrast:          { type: 'f32', def: 0.0,   gui: { label: 'Contrast', min: -1, max: 1, step: 0.01 } },
    saturation:        { type: 'f32', def: 0.0,   gui: { label: 'Saturation', min: -1, max: 1, step: 0.01 } },
    brightness:        { type: 'f32', def: 0.0,   gui: { label: 'Brightness', min: -1, max: 1, step: 0.01 } },
  },
  Measure: {
    /* WHAT THE PICTURE SHOWS. 0, the picture: luminance, exposed and tone-mapped. 1, ILLUMINANCE:
       every visible surface as the lux falling on it. The camera's first hit is replaced by a
       white Lambertian (albedo 1, no emission, opaque) for that one bounce, so the light it sends
       to the camera is E/pi whatever the surface really is -- times pi, the illuminance on its
       visible side. Everything after that first bounce is the scene as it is: light reflected by
       its real materials, through its real glass, from its real emitters, counts. A ray that
       misses everything shows 0 (the sky is not a surface). The HUD's cursor line reads lux.
       2, LUMINANCE: the picture as it is -- the real materials, the sky -- shown in false colour
       in cd/m^2 instead of exposed, so a glare source or a dim corner reads as a number. */
    /* "LUX ON SURFACES", not "illuminance": the optics trace's detector map is illuminance too, measured
       differently (the flux that reached one surface, with an error bar), and the two sat side by side
       under one word (UI_PLAN.md section 8). */
    measureMode:       { type: 'u32', def: 0,     gui: { label: 'Mode', options: { 'photographic': 0, 'lux on surfaces': 1,
                                                                                    'luminance (cd/m\u00b2)': 2 } } },
    /* The false-colour scale: logarithmic from measureMin to measureMax -- lux in the illuminance
       view, cd/m^2 in the luminance view -- blue to red (turbo).
       Below the minimum is the darkest colour, 0 is black. measureBands > 0 steps the scale into
       that many flat bands, the way lighting software draws isolux -- easier to read a level off
       than a smooth ramp. */
    measureMin:        { type: 'f32', def: 1,      gui: { label: 'False colour min (lx, cd/m\u00b2)', min: 0.001, showIf: { measureMode: [1, 2] } } },
    measureMax:        { type: 'f32', def: 100000, gui: { label: 'False colour max (lx, cd/m\u00b2)', min: 0.01, showIf: { measureMode: [1, 2] } } },
    measureBands:      { type: 'u32', def: 10,     gui: { label: 'Bands (0 = smooth)', min: 0, max: 40, step: 1, showIf: { measureMode: [1, 2] } } },
  },
  /* NO `Test` GROUP ANY MORE. It held one setting, spp -- camera rays per pixel per sample --
     and spp bought nothing a second sample per frame does not (the render loop already runs
     several), while costing the one thing light tracing needs: photons ride the same ray
     buffers AFTER the camera rays and get what is left, so at 1188x969 spp 2 halved the photons
     and spp 3 left none, and light tracing switched itself off without a word. One camera ray
     per pixel per sample is now the renderer's contract, not a setting. */
};

/* NO `Materials` GROUP HERE ANY MORE. The material override used to be one of the renderer's
   own uniform groups even though every line of WGSL that read it lived in a scene file. A
   renderer that declares uniforms only its scenes know how to interpret is not a renderer with
   a scene contract, it is a renderer with a favourite scene. A scene declares its own materials'
   uniforms (the builder's codegen does), and they arrive by the path every scene uniform takes. */
// Helper to flatten groups into a single spec if needed
export const UniformSpec = Object.assign({}, ...Object.values(UniformGroups));

// 2) State (values + types)
export function createUniformState(spec){
  const values = {}, types = {};
  /* A vector default is an OBJECT, and handing out the spec's own object meant every state
     built from it -- and every edit through the GUI -- wrote into the one default.
     COPIED IN ITS OWN SHAPE. This first spread every object default into {...}, which turns an
     ARRAY -- a builder transform's mat4, sixteen numbers -- into {0:1, 1:0, ...}. uniformToGPU
     then no longer saw an array, read it as a colour, found no r/g/b/a, and wrote a zero
     matrix: xfPoint divided by its scale of 0, every transformed object vanished, and every
     builder scene rendered black. The hand-written scenes had no matrix uniform, so nothing
     had ever asked. */
  for (const [k,s] of Object.entries(spec)) {
    values[k] = s.def && typeof s.def === 'object' ? structuredClone(s.def) : s.def; types[k] = s.type;
  }
  return { values, types, spec };
}

// 3) Centralized WGSL uniform maps per pass
// These are fed to tinywebgpu makeCompute/makeFrag so all passes share the same UB struct layout
// UI-exposed uniforms come from UniformSpec; we add non-UI technical fields here.
/* DERIVED FROM THE SETTINGS, never set directly: photometry.derive() computes all of them from the
   UI state and the scene's unit, size and radius, buildUniforms (lib/pathtracer/index.js) puts them in the same bag
   as everything else, and R.ensureSky fills in skyScale from what the sky measured. Declared for
   every compute kernel because that bag is handed to every one of them whole, and tinywebgpu
   rejects a name the schema does not have. */
export const DERIVED = {
  /* THE SCENE'S UNIT, both ways: metres per scene unit, and scene units per metre -- the boundary's two factors
     (scene_api.js SCENE_BOUNDARY: the engine works in metres, a scene in its own unit, since 0.36.0). Both here, from
     the host's doubles, so the shader multiplies by each and never divides: 1, 100 and 1000 are exact in f32. */
  sceneUnit: 'f32',
  perMetre: 'f32',
  sunL: 'f32',             // luminance of the solar disc, cd/m^2 (0 below the horizon)
  sunOneMinusCos: 'f32',   // 1 - that, computed without cancellation
  sunSin2: 'f32',          // sin^2 of the angular radius, for the membership test
  sunSolidAngle: 'f32',    // sr, the reciprocal of the cone-sampling pdf
  skyScale: 'f32',         // takes the scattering model to UB.skyIlluminance
  exposureScale: 'f32',    // display multiplier from exposureEV
  fireflyWhite: 'f32',     // cd/m^2 the display maps to 1.0, metered or manual: the firefly clamp's unit
  epsAuto: 'f32',          // the automatic surface tolerance, m: a share of the scene's size
  /* WHERE THE SCENE STOPS AND THE ENVIRONMENT BEGINS, m. A ray outside this radius and heading away from
     the origin has left; the march stops it and the shade kernel gives it envRadiance instead of a
     material. Anything the scene puts beyond it is invisible, and the sun's photons start on it.
     It replaced a sphere of exactly this radius that every scene used to declare as its first piece of
     geometry, carrying a reserved MAT_SKY material -- 400 in all three, hence the default. Then it was a
     Lighting setting, one for every scene. NOW THE SCENE'S: scene.envRadius in the scene's units (the
     builder's Scene properties), 400 m when it gives none (photometry.js envRadiusMetres), read from the
     scene the engine HAS like the unit -- so every path that swaps a scene carries it without passing it
     along, and RT.updateScene changes it without a compile. */
  envRadius: 'f32',
  /* THE SUN'S PHOTON SQUARE AND THE EMITTER SEARCH, half-sizes in METRES (the engine's unit since 0.36.0; scene units before): ltRadius and emitRadius, never
     wider than the scene's radius (photometry.js photonHalf). One number each, computed once, because each is
     read on two sides that must agree to the last bit: the photon generator and ltCovers, the emitter grid's
     writer (emitDeposit) and its reader (prog_emit_collect). */
  ltHalf: 'f32',
  emitHalf: 'f32',
  studioL: 'vec3<f32>',    // the studio light's L0 per channel, cd/m^2 (0 in sun & sky)
  /* the setting of the same name (Advanced), OVERRIDDEN: 0 whenever there is no sun, so no light
     sample is spent on a disc that is not there. Same name, so the kernels need no change. */
  neeSunPick: 'f32',
  /* THE SKETCH LIGHT'S LEVEL, lux (materials_pbr.js sketchLight): what the environment puts on a
     level surface facing up, so a manual exposure set for the scene still exposes Sketch; 1000 lx
     when the environment gives none (lamps only, night); in the Optics view, times 2^opticsFlat, or 0
     at its leftmost stop. photometry.js derive. */
  sketchE: 'f32',
};

export const ComputeUniformTypes = {
  // Frame/counters/camera
  res: 'vec2<u32>',
  seed: 'vec4<u32>',
  raycount: 'u32',        // camera rays this sample: one a pixel
  photoncount: 'u32',     // light tracing's photons this sample, what each one's flux is divided by
  emitPhotons: 'u32',     // how many of them are emitter probes; the rest sun
  /* THIS BATCH of the sample (core/photons.js planBatches), read by genrays and genphotons only: its camera rays from
     the sample's rayFirst-th on (their tiles), rayBatch of them at the buffer's start, then its photonBatch photons,
     of which the first emitBatch are emitter probes. One batch: rayFirst 0 and each the whole count. */
  rayFirst: 'u32',
  rayBatch: 'u32',
  photonBatch: 'u32',
  emitBatch: 'u32',
  ltEmit: 'u32',          // 1 when emitter probes run: the camera side then hands emitter caustics over
  ltLights: 'u32',        // 1 when the lights' photons run: the camera side then leaves them what they count (CLS_LIGHTS)
  ltLightFlux: 'f32',     // their flux per photon this sample, > 0 when they share their direct paths by MIS (Ray.ltMis)
  // 1 on the final wavefront iteration of a sample: the march kernel then terminates its
  // surviving rays and hands them to shade instead of writing them back to a ping-pong
  // buffer the next sample is about to overwrite. See THE FLUSH in wavefront.js.
  lastpass: 'u32',
  // THE STEP CACHE'S GRID (R.setStepCacheBox): its low corner and cell size (w), its cells along x, y, z; 0 cells: none
  scLo: 'vec4<f32>',
  scDims: 'vec4<u32>',
  camPos: 'vec4<f32>',
  /* THE LENS (0.43.0; core/lens.js): x its radius in metres, y the distance in focus in metres; a radius of 0 is the
     pinhole. Written with the camera's other three (index.js buildUniforms, units.js engineCamera). */
  camLens: 'vec4<f32>',
  camtype: 'u32',
  /* THE PHOTON MAP THIS SAMPLE (0.60.0; core/sppm.js, which says what each word is): x whether it runs, y its capacity;
     its radius and cell in metres and 1 / (pi r^2). Written by R.trace a sample, 0 while it is off. */
  sppmCtl: 'vec4<u32>',
  sppmGeom: 'vec4<f32>',
  // raygen tiling (precomputed on CPU for performance)
  tilesX: 'u32',
  tilesY: 'u32',
  invTilesX: 'f32',
  invTilesY: 'f32',



  invView: 'mat4x4<f32>',
  invProjection: 'mat4x4<f32>',
  // UI-driven common controls (flattened from groups)
  ...Object.fromEntries(Object.entries(UniformSpec).map(([k, v]) => [k, v.type])),
  ...DERIVED,
};

/* A SCENE MAY ADD UNIFORMS OF ITS OWN, so the compute struct stops being a constant. A scene
   declares them in the same {type, def, gui} shape the groups above use; this turns that into the
   name->type map makeCompute wants and merges it in. Only the kernels that inline the scene need
   the merged version (march, shade, occlude, and pick, field and the optics trace's). Each pipeline
   builds its own uniform buffer from its own map, so they are free to differ, and genrays, resolve,
   genphotons and emit_collect take ComputeUniformTypes alone: their text is then the same for every
   scene (genrays.js says why that matters, and what it asks of the callers). */
export const computeUniformTypes = (sceneUniforms = {}) => ({
  ...ComputeUniformTypes,
  ...Object.fromEntries(Object.entries(sceneUniforms).map(([k, v]) => [k, v.type])),
});

/* SOME SCENE PARAMETERS MUST NOT BE UNIFORMS. A uniform is poked and the next frame uses it;
   a constant is baked into the source and changing it recompiles. That sounds like a pure
   downside until the parameter is a LOOP BOUND: `for (var i = 0u; i < ITER; i++)` with ITER
   known lets the compiler unroll the loop, specialise the call and fold the surrounding
   arithmetic, and sdMenger is called three times per SDF evaluation at every march step. Made a
   uniform, none of that happens. Anything a compiler would want to know statically -- iteration
   counts, array sizes, feature switches that delete whole branches -- belongs here; anything you
   want to drag a slider on belongs in `uniforms`.

   (The scene builder in lampmaker/raytracer had this distinction as `asUniform` per node. It
   matters more on WebGPU than it did there, because pipeline creation is async and far more
   expensive than glLinkProgram.) */
/* A SCENE CONSTANT'S VALUE AS WGSL. Scalars as they always were; VECTORS AND MATRICES since 0.28.0, for a baked scene
   (builder/bake.js), whose every value is a constant: `vec3<f32>(1.0, 0.5, 2.0)`, a matrix its
   columns' numbers in order, as the uniform writer packs them. An f32 at 1e21 or more prints as "1e+21", which takes
   no ".0" (it is a float already; "1e+21.0" is not WGSL) -- below that the text is what it always was. */
const f32Literal = v => Number.isInteger(v) && Math.abs(v) < 1e21 ? `${v}.0` : `${v}`;
const scalarLiteral = (type, v) => type === 'u32' ? `${Math.max(0, v | 0)}u` : type === 'i32' ? `${v | 0}` : f32Literal(v);
const wgslLiteral = (type, v) => {
  const m = /^(vec\d|mat\dx\d)<(f32|u32|i32)>$/.exec(type);
  if (m) return `${type}(${Array.from(v, x => scalarLiteral(m[2], x)).join(', ')})`;
  return scalarLiteral(type, v);
};

/* A SCENE WITHOUT LIGHT FACES, as light sampling asks for them (PLAN.md L7; materials_pbr.js,
   scene_api.js). A builder scene with lights defines its own (codegen emitLightFaces); every other
   scene -- one without lights, a bench's, a hand-written one, the studio's -- has none, and says so
   here, in the one piece of text every kernel puts between the prelude and the scene. DECIDED FROM
   THE TEXT, not from a flag beside it: the profile's sphere scene (profile.js sphereScene) copies a
   builder scene's fields and swaps in a WGSL of its own, and the flag it carried across said the
   faces were there when they were not -- eight kernels that did not compile. */
export const NO_LIGHT_FACES = `const LIGHT_FACES: u32 = 0u;
fn lightFaceTotal() -> f32 { return 0.0; }
fn lightFacePick(u: f32) -> u32 { return 0u; }
fn lightFace(i: u32) -> LightFace { var f: LightFace; return f; }
fn lightFaceLe(f: LightFace, cosT: f32) -> VEC3 { return VEC3(0.0); }
`;
/* HOW MANY LIGHT FACES A SCENE DECLARES, read from its text as sceneConstantsWGSL decides whether it has any: the
   count codegen (emitLightFaces) and scenedata.js (lightFacesWGSL) write; 0 for every other scene. The surface kernel
   copies that many into shade's light table (tracebasics.js FACE_TABLE) and refuses a scene with more than it holds. */
export const lightFaceCount = (scene) => {
  const m = /\bconst\s+LIGHT_FACES\s*:\s*u32\s*=\s*(\d+)u\b/.exec(scene?.wgsl ?? '');
  return m ? +m[1] : 0;
};
export const sceneConstantsWGSL = (scene) => {
  const faces = /\bconst\s+LIGHT_FACES\b/.test(scene?.wgsl ?? '') ? '' : NO_LIGHT_FACES;
  const spec = scene?.constants;
  if (!spec) return faces;
  const vals = scene.constValues || {};
  return faces + Object.entries(spec)
    .map(([k, s]) => `const ${k}: ${s.type} = ${wgslLiteral(s.type, vals[k] ?? s.def)};`)
    .join('\n') + '\n';
};

/* EVERYTHING OF A SCENE THAT A KERNEL COMPILES, as one string: its four texts (render, pick, and the optics trace's two),
   its uniforms' layout, its resources and its constants. Two scenes with the same are drawn by the same kernels, so one
   can take the other's place without a compile (lib/pathtracer/index.js updateSceneData: the builder's scene as data). */
export const sceneTextOf = scene => JSON.stringify([scene.wgsl, scene.pickWgsl ?? null, scene.opticsWgsl ?? null, scene.opticsPickWgsl ?? null,
  computeUniformTypes(scene.uniforms || {}), scene.resources || {}, sceneConstantsWGSL(scene)]);
/* ...AND WHAT A SCENE SAYS ABOUT ITSELF THAT IS NOT TEXT, which updateSceneData copies into the scene the engine holds. ONE
   LIST, here, because it was a list in three places (the engine and two test stand-ins, builder/test/dataapply and
   bindlive) and all three lacked `unit`: a scene's numbers in every unit make the same text (bench.test checks it), so a
   data scene whose unit was changed in the panel was swapped in by this path and the engine kept the old unit -- every
   length the shader took through it (the tolerance, the radius, the camera since 0.36.0) a factor of 10 or 1000 out. */
export const SCENE_DATA_KEYS = Object.freeze(['tags', 'opticsTags', 'unit', 'extent', 'envRadius', 'uniforms', 'body', 'map', 'title',
  'detectors', 'passes']);

export const RenderUniformTypes = {
  // screen space resolution as float for pixel math in fragment
  res: 'vec2<f32>',
  // display: exposure (derived from exposureEV, or metered: autoExposure), the tone curve, and
  // the grading applied after sRGB encoding
  exposureScale: 'f32',
  autoExposure: 'u32',
  exposureComp: 'f32',
  toneMap: 'u32',
  contrast: 'f32',
  saturation: 'f32',
  brightness: 'f32',
  // the illuminance view (Measure): what to show, and its false-colour scale
  measureMode: 'u32',
  measureMin: 'f32',
  measureMax: 'f32',
  measureBands: 'u32',
};
/* ...AND THE LIVE DISPLAY'S OWN, over those: the step cache's cells shown over the picture (rendertoscreen.js
   STEP_CACHE_VIEW_WGSL) -- whether, its grid, and the camera, to walk each pixel's ray through it. Apart from
   RenderUniformTypes because the develop pass (main's, merged in 0.27.1) declares RenderUniformTypes too and writes every
   name it declares (develop.js developUniforms), and a saved picture never shows the cells. */
export const DisplayUniformTypes = {
  ...RenderUniformTypes,
  stepCache: 'u32',
  stepCacheView: 'u32',
  scLo: 'vec4<f32>',
  scDims: 'vec4<u32>',
  invView: 'mat4x4<f32>',
  invProjection: 'mat4x4<f32>',
  camPos: 'vec4<f32>',
  camtype: 'u32',
};

/* WHAT THE GUI HOLDS IS NOT WHAT THE GPU TAKES, for a vector.
   tinywebgpu's uniformWrite wants an array (or a TypedArray) and wraps anything else as
   [value] -- so a plain {x,y,z} is written as a single NaN, silently. Tweakpane wants exactly
   that {x,y,z} and has no controller for an array at all: hand it one and it throws
   "No matching controller for 'centre_ball'".

   So the uniform state holds the GUI's shape and this normalises on the way out. It only
   showed up when the scene builder declared the first VECTOR scene uniform -- the three
   hand-written scenes are all scalars, so the contract had never been asked the question. */
export const uniformToGPU = (v, type) => {
  if (v == null || typeof v !== 'object' || Array.isArray(v) || ArrayBuffer.isView(v)) return v;
  const n = +(/vec(\d)/.exec(type || '')?.[1] || 4);
  const order = ('x' in v ? ['x', 'y', 'z', 'w'] : ['r', 'g', 'b', 'a']).slice(0, n);
  return order.map(k => v[k] ?? 0);
};

// 4) Small helper: default values bag compatible with the above types
export function defaultUniformValues() {
  const u = {};
  for (const [k, s] of Object.entries(UniformSpec)) u[k] = s.def;
  // sensible defaults for technical fields
  Object.assign(u, {
    raycount: 0,
  });
  return u;
}


