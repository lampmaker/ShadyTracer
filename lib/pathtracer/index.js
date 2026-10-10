//======================================================================================================================
// PATHTRACER -- the renderer as something a program can call.
//
// WHAT THIS IS FOR. The renderer used to be an application: the page owned the loop, the camera,
// the uniform assembly and the canvas, and the only way to get a picture was to be that page.
// Every use it is actually wanted for inverts that. An object builder owns an editor and wants a
// preview. A weave editor's real UI is 2D jacquard and rendering is a button. A flow simulation
// owns its data and its frame and wants the current state drawn. In none of them is the renderer
// the host.
//
// So: `createPathTracer()` returns an object with `step(n)` as its central verb -- advance the
// picture by n samples, when the caller says so -- and everything else arranged around that. The
// rAF loop (lib/render-loop.js; RT.start()) is opt-in, because a renderer that schedules its own frames
// cannot be embedded in a program that schedules its own frames.
//
// THE HOST OWNS THE DEVICE. `gpu` is an already-initialised tinywebgpu instance, not one created
// here. That is what lets a simulation hand over textures it is still writing: they are already
// on this device, so a scene can declare them as resources and the kernels sample them in place.
// CODE_WOOD/FLOWTRACER proved that works and cost nothing; what broke there was everything
// around it, which is why a scene describes what it hands over rather than passing bare handles.
//
// WHAT IS STILL MISSING, honestly: this wraps the existing engine rather than replacing it, so
// `core/` still reaches for a canvas through Q. An offscreen target exists (beginOffscreen and
// renderFrame below: the save, the timeline's frames, the studio's pictures).
//======================================================================================================================

import { RAYTRACER } from './core/raytrace_main.js'
import { rayThrough } from './core/genrays.js'
import { UniformGroups, createUniformState, uniformToGPU, sceneTextOf, SCENE_DATA_KEYS } from './core/uniforms.schema.js'
import { derive, meterEV100, EPS_FALLBACK } from './core/photometry.js'
import { toleranceInUse, resolveTolerances } from './core/tolerances.js'
import { engineCamera, toEngine, toScene } from './core/units.js'
import { installStatsHook, showFPS } from './core/utilities.js'
import { installTestMenu } from './tests.js'
import { makeCostInstrument } from '../render-cost.js'
import { makeRenderLoop, makeHolds, countResets } from '../render-loop.js'
import { settingsParams, CAM_FIELDS, camBindings } from './params.js'
import { untitledTable } from './sections.js'
import { tagFieldTags } from './core/field.js'
import { effective } from './quality.js'
import { makeSettingsUI, RENDERER_BOXES, boxIcon } from './settingsui.js'
import { runSamples } from './samples.js'
import { planBatches } from './core/photons.js'
import { makeDarkroom, viewSettings, fitPreview } from './develop.js'

/** The renderer's own settings. A scene's parameters are NOT here -- they arrive with the scene
 *  and are merged in by the engine; see the scene contract.
 *
 *  `Materials` used to be on this list, and taking it off is what finished the split: every
 *  line of WGSL that read those uniforms was already scene-side, so the renderer was
 *  declaring names only its favourite scene knew how to interpret. A scene declares its own
 *  materials' uniforms now, and they arrive the way every scene uniform does. */
const GROUPS = ['Tracing', 'Lighting', 'Exposure', 'Measure', 'Advanced']

/** WHAT A SCENE SWAP KEEPS of the values set before it (setScene below says why): into `next` (the new
 *  scene's fresh values), every name both declare -- unless the new scene's values are its own
 *  (carryUniforms: false, a document's) and it is not the same scene again. Pure, for the test. */
export function carryAcross(prev, next, { from = null, to = null } = {}) {
    if (to?.carryUniforms === false && to !== from) return next
    for (const k of Object.keys(next)) if (k in prev) next[k] = prev[k]
    return next
}

/**
 * @param gpu     an initialised tinywebgpu instance -- the HOST created the device
 * @param ctx     the canvas context it was initialised against (for the camera's input element)
 * @param Q       the settings bag: canvas size, camera seed, resetframecount
 * @param scene   the initial scene (see scenes/)
 * @param CAMERA  the camera constructor, passed in rather than imported so a host can supply
 *                its own controls without this module growing a dependency on one
 * @param hud     false for a renderer whose numbers stay out of the page's Render stats (a second,
 *                offscreen one: the library's studio)
 */
export async function createPathTracer({ gpu, ctx, Q, scene, CAMERA, minfps = 20, hud = true }) {
    /* The facade is BOLTED ONTO the engine object rather than wrapping it, which is how the page
       did it and is worth keeping. The test bench reaches for engine-level state on the same
       object it calls set() on -- budgetOverride, submitEvery, imageStats -- and a
       wrapper would have to re-export all of it or silently drop half. One object, one surface. */
    const RT = RAYTRACER(gpu, null, Q, scene)
    /* EVERY RESET OF THE PICTURE, COUNTED (RT.resets below, render-loop.js countResets): Q.resetframecount = 1 is how
       anything says the picture is of something else now -- a scene uniform, the camera, the scene, the size, a light
       the optics module lights it with -- and the Optics page's Live analysis adds rounds to its estimate only while
       that does not happen. After RAYTRACER: the engine writes the same bag. */
    const resets = countResets(Q)
    /* A QUIET RENDERER (hud: false) keeps its numbers to itself: a second one in the page -- the
       library's studio, rendering thumbnails -- wrote its frame rate, samples and photons into the
       view's Render stats, since the readout is one per page (core/utilities.js showFPS). */
    if (!hud) { const quiet = () => { }; quiet.refresh = () => { }; RT.hud = quiet }
    const engineSetScene = RT.setScene
    /* Captured for the same reason: the facade's pick() replaces the engine's on this object
       (Object.assign at the bottom), and calling RT.pick from it would call itself. */
    const enginePick = RT.pick
    /* ...and the step cache's box, for the same reason. It was not captured in 0.23.0 and 0.24.0: the facade's
       setStepCacheBox called RT.setStepCacheBox -- itself -- until the stack ran out, on the first box the page or the
       bench handed in. build.test.mjs now builds this facade and checks every method it replaces this way. */
    const engineSetStepCacheBox = RT.setStepCacheBox

    //------------------------------------------------------------------------------------------
    // Settings. One state object per group, and a `sceneState` that is replaced on every scene
    // change -- which is why everything below reads it through the closure rather than capturing
    // its `values` once.
    //------------------------------------------------------------------------------------------
    const states = Object.fromEntries(GROUPS.map(g => [g, createUniformState(UniformGroups[g])]))
    let sceneState = createUniformState(scene.uniforms || {})
    const allStates = () => [...Object.values(states), sceneState]

    let cam = null, uniforms = null, onRefresh = () => { }

    //------------------------------------------------------------------------------------------
    // RENDER SIZE. The renderer's, not the page's.
    //
    // It used to be a constant: the host seeded Q with {a:1, s:1024} and utils.js's ctx.Sc
    // turned that into Q.w = Q.h = 1024 forever, so a wide window got a square picture
    // letterboxed into it and a 4K display got the same megapixel as a laptop. The resize
    // listener recomputed the identical two numbers on every event.
    //
    // Three settings replace it. `mode` is whether the picture follows the panel or is a size
    // you chose; `scale` is the downscale, and it is the one that matters on a big display --
    // tracing 8.3 Mpx for a preview nobody is pixel-peeping is most of a frame thrown away.
    //
    // NOT GOING THROUGH ctx.Sc, for two reasons. utils.js is marked not-to-be-changed-by-AI,
    // and Sc's encoding needs algebra to read: Q.s is the LONG EDGE, Q.w = Q.s * min(a,1), so
    // asking it for 1080x1920 means passing s=1920. Writing Q.w/Q.h and the backing store
    // says what it does. Nothing else in the project reads Q.a or Q.s.
    //
    // LETTERBOXING IS FREE and deliberately not implemented here: the canvas is created with
    // `width:100%; height:100%; object-fit: contain` (utils.js:89), so a backing store of any
    // shape is centred and scaled into the panel by the browser, filtered. That is also what
    // makes `scale` cost nothing to display -- a half-size buffer is upscaled smoothly rather
    // than showing as a small picture.
    //------------------------------------------------------------------------------------------
    const SIZE = { mode: 'fit', width: 1920, height: 1080, scale: 1 }
    /* ?s=2048&a=1.7778 still works, because GU merges the query string onto Q before we get
       here. It only means anything if the host stopped hardcoding those keys -- which is the
       point: present means asked for. */
    if (+Q.s) {
        const a = +Q.a || 1
        SIZE.mode = 'fixed'
        SIZE.width = Math.round(+Q.s * Math.min(a, 1))
        SIZE.height = Math.round(SIZE.width / a)
    }
    const sizeInfo = { actual: '' }

    const maxDim = () => gpu.device?.limits?.maxTextureDimension2D || 8192
    const clampDim = v => Math.max(16, Math.min(maxDim(), Math.round(v) || 16))

    /** The single writer of Q.w/Q.h. Returns whether anything actually changed. */
    const applySize = () => {
        const el = ctx?.canvas?.parentElement || ctx?.canvas
        const fit = SIZE.mode === 'fit'
        // clientWidth is 0 until the layout settles; the clamp floor keeps that from reaching
        // the GPU, and the ResizeObserver corrects it on the first real measurement
        const w = clampDim((fit ? (el?.clientWidth || 0) : SIZE.width) * SIZE.scale)
        const h = clampDim((fit ? (el?.clientHeight || 0) : SIZE.height) * SIZE.scale)
        sizeInfo.actual = w + ' \u00d7 ' + h
        if (w === Q.w && h === Q.h) return false
        Q.w = w; Q.h = h
        if (ctx?.canvas) { ctx.canvas.width = w; ctx.canvas.height = h }
        cam?.resize?.(w / h || 1)
        /* Clear, don't just re-weight. ensureBuffers is grow-only, so SHRINKING leaves the old
           picture in an oversized buffer being read back at the new, narrower stride -- the
           image skews rather than fades. Growing gets a zeroed buffer for free; clearing
           covers the other direction. */
        try { RT.clearAccums() } catch { }
        Q.resetframecount = 1
        return true
    }
    applySize()          // before the camera: it is built from Q.w / Q.h

    /* The panel drives the size in fit mode. A ResizeObserver rather than window.resize,
       because the splitter moves without the window changing at all -- dragging it used to
       leave the picture at whatever it was. rAF-debounced: an observer fires per layout pass
       and a drag is a continuous stream of them, each one otherwise reallocating buffers. */
    let roPending = 0
    try {
        new ResizeObserver(() => {
            if (roPending) return
            roPending = 1
            requestAnimationFrame(() => {
                roPending = 0
                if (SIZE.mode === 'fit' && !OFF && applySize()) { onRefresh(); present() }
            })
        }).observe(ctx?.canvas?.parentElement || ctx?.canvas)
    } catch { }

    const buildUniforms = () => {
        const CU = cam?.getUniforms?.()
        /* AS TRACED, not as set (quality.js effective): the measuring views in full, Draft's light
           sample, Sketch without light, lamps only's black environment. Only the bag is overridden --
           the states keep what the user set, so the panel, a workspace and the scene's environment
           never see the override. Every path to the kernels goes through this bag (R.trace and
           the optics module's uniformBag), so none of them can disagree about the mode. */
        const asSet = Object.assign({}, ...Object.values(states).map(s => s.values))
        const traced = effective(asSet)
        const over = Object.fromEntries(Object.entries(traced).filter(([k, v]) => v !== asSet[k]))
        const derived = derive(traced, { unit: RT.scene?.unit, extent: RT.scene?.extent, envRadius: RT.scene?.envRadius })
        /* THE CAMERA IN THE ENGINE'S UNIT, metres (core/units.js engineCamera): the camera object is the scene's, in its
           unit -- the builder's views, gizmos and saved cameras -- and only what the kernels read is converted, here, the
           one place every path to them goes through (R.trace, the optics module's uniformBag, the path drawer) */
        const camtype = cam?.get?.().camtype ?? 0
        const EC = engineCamera(CU, camtype, derived.sceneUnit)
        uniforms = {
            /* Normalised per field: a vector is {x,y,z} in the state because that is what
               the property table can edit, and an array here because that is what the
               uniform writer accepts. See uniformToGPU. */
            ...Object.fromEntries(allStates().flatMap(s =>
                Object.entries(s.values).map(([k, v]) => [k, uniformToGPU(v, s.types[k])]))),
            ...over,
            /* THE PHYSICAL UNIFORMS, derived here from the settings above and the scene's unit
               -- never set directly, so a setting and what the shader sees cannot drift apart.
               The unit is read from the scene the engine HAS, so every path that swaps it (the
               Scene page, the builder's apply, a recompile, the bench) is covered without any of
               them passing it along. So is the scene's radius (envRadius, scene units; RT.updateScene
               changes it live). skyScale comes out 0 here and is filled in by the engine,
               the only place that knows what the sky measured -- see R.ensureSky. */
            ...derived,
            invView: EC?.invView,
            invProjection: EC?.invProjection,
            camPos: EC?.camPos,
            camLens: EC?.camLens,
            camtype,
        }
        // the cursor readout reads lux in the illuminance view: the picture there is E/pi
        RT.hud.lux = (uniforms.measureMode | 0) === 1
        // what the readout says the picture is: the mode asked for, the mode traced, lamps only
        // ...and the surface tolerance in use, and how it was chosen (core/tolerances.js): the readout's and the panel's
        RT.hud.tolerance = toleranceInUse(uniforms, RT.scene, EPS_FALLBACK)
        RT.hud.render = { asked: asSet.renderMode | 0, mode: traced.renderMode, lampsOnly: (asSet.lampsOnly | 0) === 1,
                          lightRaysOff: ((asSet.lightRays ?? 1) | 0) === 0 }
    }
    /** Rebuild the uniform bag and, unless told otherwise, restart the accumulation -- BUT ONLY
     *  IF SOMETHING CHANGED. Tweakpane's refresh() treats a value changed programmatically as a
     *  change and fires the binding's 'change' handler, which lands here. So every RT.set was
     *  followed, one animation frame later, by a second update with identical values and a
     *  reset nobody asked for. With the loop running that restarts the EMA a frame late, which
     *  nobody sees; with it stopped, the flag stayed at 1 through a whole bench step -- every
     *  one of 32 traces reset the window, the image held the last few samples, and the `noise`
     *  column of the lt bench came out 2.3x high on the rows where the refresh won the race. */
    let uniformSig = ''
    const update = (reset = true) => {
        buildUniforms()
        const sig = JSON.stringify(uniforms)
        if (reset && sig !== uniformSig) Q.resetframecount = 1
        uniformSig = sig
        syncKernels()
    }
    /* THE KERNELS' OWN OPTIONS FOLLOW THE SETTINGS (0.29.0; raytrace_main.js R.kernelOptions): a feature compiled in only
       when on -- the step cache, its view -- needs a build when its setting changes. Asked here, at every update, and
       built by one job at a time:
       - THE OPTIONS ARE SET AT ONCE (RT.kernelOptions), so any build that begins from now on -- a scene swapped in, the
         first build -- builds them; the job does what is left, if anything. The benchmark leans on that: it sets a
         row's options and then swaps its scene in, in one task, and the job, waking after, finds them built (no
         compile of the scene before with the row's options).
       - THE JOB WAITS for any swap or build under way, then builds with the loop held (no frame meanwhile; the loop
         keeps its running state) -- and a swap asked while it builds waits for it (setScene), so two builds never
         install their kernels over each other.
       - OPTIONS REFUSED -- a build that failed, the ones before put back (R.applyKernelOptions) -- are not asked again
         until the settings ask for something else: update() runs at every camera move.
       RT.kernelsSettled() resolves when no job is left: the benchmark awaits it before it compiles or times a row. */
    let kernelJob = null, kernelBuild = null
    const syncKernels = () => {
        const want = RT.kernelOptionsOf(uniforms)
        if (RT.sameKernelOptions(want, RT.kernelOptions) || RT.sameKernelOptions(want, RT.kernelOptionsRefused)) return
        RT.kernelOptions = want
        kernelJob ??= (async () => {
            try {
                for (;;) {
                    await new Promise(r => setTimeout(r, building() ? 50 : 0))
                    if (building()) continue
                    if (RT.sameKernelOptions(RT.kernelOptions, RT.builtOptions)) return
                    const release = HOLDS.hold()
                    swapping++
                    try { await (kernelBuild = RT.applyKernelOptions()) }
                    catch (e) { console.error('[pathtracer] the kernels for the settings would not build; the ones before are back:', e?.message ?? e); return }
                    finally {
                        kernelBuild = null; swapping--; release()
                        Q.resetframecount = 1
                        if (missed && !building() && !LOOP.running()) { missed = false; present() }
                    }
                }
            } finally { kernelJob = null }
        })()
    }
    /* ONE TRACE, AND THE RESET IT CONSUMED. The render loop clears resetframecount after each
       frame (consumeReset); every other caller -- step(), renderFrame() -- used to
       have to remember to, and a reset that arrived while one of them was running was re-read
       by every trace after it, pinning the EMA window at two samples. trace() reads the flag
       synchronously before its first await, so clearing it right after the call is exactly the
       loop's "a reset applies to one frame". */
    /* A RENDERER THAT DOES NOT OWN THE CANVAS draws only offscreen. A frame with no target goes to
       the device's swapchain -- gpu.context, the canvas the HOST initialised it against -- and a
       second renderer on the same device (the library's studio, whose own canvas is a detached one
       for its camera to listen to) put its grainy one-sample thumbnails into the main view that
       way: present() after every endOffscreen, after every camera change it made. Everything that
       draws without a target is refused for such a renderer, not just the paths seen so far. */
    const onScreen = !gpu.context || !ctx?.canvas || ctx.canvas === gpu.context.canvas
    const traceOnce = (target) => {
        if (!target && !onScreen) throw new Error('[pathtracer] this renderer has no canvas of its own: render offscreen')
        const p = RT.trace(Q, uniforms, 1, target)
        Q.resetframecount = 0
        return p
    }

    //------------------------------------------------------------------------------------------
    // Cost instrument and loop
    //------------------------------------------------------------------------------------------
    const COST = makeCostInstrument(gpu)
    RT.cost = COST
    if (hud) installStatsHook(COST)

    const HOLDS = makeHolds()            // RT.hold below; counted, so they nest (render-loop.js)
    const LOOP = makeRenderLoop(
        count => RT.trace(Q, uniforms, count),
        COST,
        { minfps, consumeReset: () => (Q.resetframecount ? (Q.resetframecount = 0, true) : false),
          held: HOLDS.held })

    //------------------------------------------------------------------------------------------
    // Camera. Constructed here because the uniform assembly needs it every frame, but the
    // constructor is injected so this file does not decide what a camera is.
    //------------------------------------------------------------------------------------------
    let cameraControls = new Map()
    if (CAMERA) {
        cam = CAMERA({
            canvas: ctx.canvas, aspect: Q.w / Q.h || 1, fov: Q.fov, near: .01, far: 4000, up: [0, 0, 1],
            onChange: () => {
                update(); onRefresh()
                try {
                    const vis = cam.getControlVisibility({ camtype: cam.get().camtype, mode: cam.get().mode })
                    Object.entries(vis).forEach(([k, show]) => {
                        const c = cameraControls.get(k); if (c) c.hidden = !show
                    })
                } catch { }
            }
        })
        try {
            cam.set({
                camtype: Q.camtype, dimensions: Q.dimensions, mode: 'orbit',
                azimuth: Q.azimuth, elevation: Q.elevation, distance: Q.distance, fov: Q.fov
            })
            cam.getUniforms()       // inverse matrices must exist before the first render
        } catch { }
    }
    buildUniforms()

    //------------------------------------------------------------------------------------------
    // THE CURSOR READOUT -- the luminance under the mouse and its error bar, on the HUD (the
    // engine's R.probeAt / R.readProbe do the reading). The canvas is object-fit: contain (see
    // RENDER SIZE), so the picture is letterboxed inside the element's box: the pixel under the
    // cursor comes from fitting Q.w x Q.h into that box, and y is flipped because the
    // accumulation's row 0 is the bottom of the picture. Listening costs nothing until the
    // mouse is over the picture; leaving it clears the line.
    //------------------------------------------------------------------------------------------
    const cursorPixel = ev => {
        const r = ctx.canvas.getBoundingClientRect()
        const W = Q.w, H = Q.h
        const s = Math.min(r.width / W, r.height / H), dw = W * s, dh = H * s
        const u = (ev.clientX - r.left - (r.width - dw) / 2) / dw
        const v = (ev.clientY - r.top - (r.height - dh) / 2) / dh
        if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return null     // on the letterbox bars
        return [Math.floor(u * W), Math.floor((1 - v) * H)]
    }
    if (ctx?.canvas?.addEventListener) {
        ctx.canvas.addEventListener('mousemove', ev => {
            if (OFF) return                        // an offscreen render owns the buffers' size
            RT.probeAt = cursorPixel(ev)
            RT.readProbe()
            if (!RT.probeAt) RT.hud.refresh()
        }, { passive: true })
        ctx.canvas.addEventListener('mouseleave', () => {
            RT.probeAt = null
            RT.readProbe()                         // clears the reading
            RT.hud.refresh()
        }, { passive: true })
    }

    //------------------------------------------------------------------------------------------
    // OFFSCREEN RENDERING -- a picture at a size that has nothing to do with the window.
    //
    // THE VERBS ARE NAMED FOR lib/timeline ON PURPOSE. makeSequencer asks a host for exactly
    // four things -- begin({width,height,samples}), render(samples), grab(), end() -- and
    // weavesim implements them by hand in its page. Building them here, with those shapes,
    // means wiring the sequencer up later is a call site and not a change to the renderer.
    // That is the only concession this file makes to a library it does not import.
    //
    // It has to be offscreen rather than a canvas readback: the swapchain is configured with
    // RENDER_ATTACHMENT only (tinywebgpu.js:227, the host passes no canvasUsage), so the
    // presented image has no COPY_SRC and cannot be read back at all.
    //------------------------------------------------------------------------------------------
    let OFF = null

    /* ONE FRAME, WHEN NOTHING IS DRIVING THE LOOP. Assigning canvas.width clears the drawing
       buffer, so resizing while paused -- after a bench run, after a save, or just paused --
       leaves the viewport black until something submits again. Nothing else would: the loop is
       what normally presents. rAF-coalesced so a drag does not queue one of these per event. */
    /* NOT WHILE A SCENE IS SWAPPED IN. setScene stops the loop, so to present() a swap looked like
       "nothing is driving the loop" -- and a redraw asked for meanwhile (the optics page draws its
       overlay at startup, while the first scene compiles) traced with kernels whose resources are
       not bound yet: "No resources bound", and the frame's encoder left invalid. A redraw asked
       for meanwhile is remembered, and setScene presents it when the swap has succeeded.
       NOR WHILE ANY BUILD RUNS, OR BEFORE THE FIRST HAS SUCCEEDED. The fix above (530a9d7) marked
       setScene's swap only, and setScene is not the only build: RT.init builds the first scene's
       pipelines, outside any swap, and on a cold load (a new incognito window, 2026-09-30) a redraw
       during it hit the same "No resources bound". So this asks the engine, which every build passes
       through (raytrace_main.js _building / _built), and a redraw missed during a build that no swap
       will present afterwards -- init's -- is presented when that build ends (the listener below). */
    let presenting = 0, swapping = 0, missed = false
    const building = () => swapping || RT._building > 0 || !RT._built
    const present = () => {
        if (!onScreen) return                        // nothing of its own to present to (above)
        if (building()) { missed = true; return }
        if (presenting || OFF || LOOP.running()) return
        presenting = 1
        requestAnimationFrame(async () => {
            presenting = 0
            if (building()) { missed = true; return }    // a build began after it was asked for
            if (OFF || LOOP.running()) return
            try { await RT.trace(Q, uniforms, 1) } catch (e) { console.error('[pathtracer]', e) }
        })
    }
    /* A build over: present what was asked for during it -- unless a swap is still under way (setScene
       presents its own once the scene's uniforms are carried over), the build failed (_built false: there
       is still nothing to trace with), or the loop is running and will present anyway. */
    RT.compileListeners.add(p => {
        if (!p.end || !missed || building() || LOOP.running()) return
        missed = false
        present()
    })

    /** What a render of this size would cost, and whether the device will take it. Checked
     *  before anything is allocated, because ensureBuffers destroys the old buffers before it
     *  creates the new ones -- a throw halfway through leaves the renderer with null buffers
     *  and rebind() unreached. */
    /* WITH THE PHOTONS (0.38.1): the buffer is sized for the camera rays and the photons the settings ask for, as
       R.ensureBuffers sizes it, and what does not fit it runs in batches (core/photons.js planBatches) -- `batches` is
       how many a sample of this size will take, each the whole wavefront chain. Every pixel gets its ray and every
       photon is sent either way: the size changes the time, never the light. */
    const sizeVerdict = (w, h) => {
        const L = gpu.device?.limits || {}
        const pixels = w * h
        const perPixel = Math.max(0, +RT.photonsPerPixel?.(uniforms || {}) || 0)
        const photons = Math.ceil(pixels * perPixel)
        const rays = Math.min(RT.maxRays || pixels + photons, pixels + photons)
        const batches = planBatches(rays, [pixels, photons]).batches
        // the engine's own sizes (raytrace_main.js): set when it is made, so never missing here
        const biggest = Math.max(pixels * 16, rays * RT.hitStructSize, rays * RT.rayStuctSize)
        const total = pixels * 32 + rays * (RT.rayStuctSize * 2 + RT.hitStructSize)
        if (h > 65535) return `height ${h} exceeds the workgroup limit`
        const cap = L.maxStorageBufferBindingSize
        if (cap && biggest > cap)
            return `needs a ${(biggest / 1e6) | 0} MB buffer; this device allows ${(cap / 1e6) | 0} MB`
        return { pixels, rays, total, photons, batches }
    }

    /** Point the renderer at an offscreen target of the given size. Stops the loop. */
    const beginOffscreen = async ({ width, height } = {}) => {
        if (OFF) throw new Error('[pathtracer] an offscreen render is already in progress')
        const w = clampDim(width || Q.w), h = clampDim(height || Q.h)
        const verdict = sizeVerdict(w, h)
        if (typeof verdict === 'string') throw new Error(`[pathtracer] ${w}x${h}: ${verdict}`)

        const wasRunning = LOOP.running()
        LOOP.stop()
        /* Stopping is not draining. LOOP.stop() clears a flag the loop checks on ENTRY, so a
           frame already inside it still records and submits, and the queue behind that can be
           seconds deep. One rAF lets the in-flight callback finish, then wait for the GPU --
           otherwise the first thing the new size does is allocate on top of a backlog that is
           still holding the old buffers. */
        await new Promise(r => requestAnimationFrame(r))
        await gpu.device.queue.onSubmittedWorkDone()

        /* PIN THE AVERAGING. maxaverages was 10 by default once (it is 0 now, uniforms.schema.js) --
           a short EMA window, because an interactive view wanted to forget the frames from before
           the camera moved. Left at 10 for a 500-sample save you get a 10-sample image after eight
           minutes of work. 0 means unlimited, i.e. the true mean, which is what a save is for; a
           window set since, from the console or a workspace, must not shorten a save either. */
        const pinned = api.get()
        const restore = { maxaverages: pinned.maxaverages }
        api.set({ maxaverages: 0 }, false)

        /* gpu.format, not rgba8unorm: the present pipeline's colour target was fixed at the
           canvas format when it was compiled, and a render target has to match it. On most
           platforms that is bgra8unorm, which is why both save() and grabFrame() swap the
           channel ends on the way out. Allocated before the tracer's buffers grow, so a
           failure here costs nothing. */
        let tex = null
        try { tex = gpu.createTexture(w, h, gpu.format) }
        catch (e) { api.set(restore, false); if (wasRunning) LOOP.start(); throw e }

        OFF = { w, h, wasRunning, restore, tex, prevW: Q.w, prevH: Q.h }
        /* The canvas keeps its own backing store and simply freezes on its last frame. Resizing
           it to the export size would make the window jump about for the duration, and the
           browser would be scaling a picture that is not being drawn. */
        Q.w = w; Q.h = h
        cam?.resize?.(w / h || 1)
        buildUniforms()
        await RT.clearAccums()
        /* ZERO, NOT ONE. resetframecount is cleared by the render loop's consumeReset, and the
           loop is stopped -- so left at 1 it is re-read at the top of EVERY trace, which sets
           the EMA window back to zero each time, so every sample replaces the picture. Five
           hundred samples would converge no further than one does. The bench hit this first and documents it. */
        Q.resetframecount = 0
        return OFF
    }

    /** Accumulate `samples` samples into the offscreen target. An AbortSignal stops it between
     *  samples with an AbortError -- a thousand samples at 4K is minutes, and closing the tab
     *  was the only way out. Between samples, because a trace in flight cannot be recalled; the
     *  wait is what is in flight -- one sample, or two with `inFlight` 2. The caller's finally
     *  (endOffscreen) puts the live view back.
     *  `inFlight` 2 records the next sample while the GPU runs this one (samples.js says why).
     *  The save, the timeline's frames and the studio's pictures ask for it; the default stays 1,
     *  so the sequencer's render(samples) and the benchmark's single samples are what they were,
     *  and a new caller opts in knowingly. Nothing can be read back before the last sample is
     *  done either way: runSamples returns only then, and a readback is queued behind it. */
    const renderFrame = async (samples = 1, onProgress = null, signal = null, { inFlight = 1 } = {}) => {
        if (!OFF) throw new Error('[pathtracer] renderFrame outside beginOffscreen')
        /* RT.trace, which has no await between its beginFrame and endFrame: that atomicity is
           what makes a size change safe (the experimental TRACE2 flow, gone in 0.22.2, awaited a
           counter readback in the middle of a sample, so Q.w/Q.h could change underneath it).
           The GPU is waited for per sample, not at the end: it keeps the page responsive and
           it is what makes a progress readout mean anything. With two in flight that is still
           true -- at most one sample is queued behind the one running, and progress is
           reported as each finishes. */
        return runSamples(samples, { trace: () => traceOnce(OFF.tex), done: () => gpu.device.queue.onSubmittedWorkDone(),
                                     inFlight, onProgress, signal })
    }

    /** The offscreen target as an OffscreenCanvas -- what a sequencer's grab() must return. */
    const grabFrame = async () => {
        if (!OFF) throw new Error('[pathtracer] grabFrame outside beginOffscreen')
        const px = await gpu.readTexture(OFF.tex, { Ctor: Uint8Array })
        if (gpu.format.startsWith('bgra'))
            for (let i = 0; i < px.length; i += 4) { const b = px[i]; px[i] = px[i + 2]; px[i + 2] = b }
        const c = new OffscreenCanvas(OFF.w, OFF.h)
        c.getContext('2d').putImageData(
            new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, px.length), OFF.w, OFF.h), 0, 0)
        return c
    }

    /* THE DARKROOM (develop.js): the last picture rendered for saving, kept as light, to expose and tone-map after the
       render. One picture at a time; the next render replaces it. */
    const DARKROOM = makeDarkroom(gpu)

    /** Free the target, put the live size back, restart the loop if it was running. */
    const endOffscreen = async () => {
        if (!OFF) return
        const o = OFF
        OFF = null
        try { o.tex.destroy() } catch { }
        api.set(o.restore, false)                     // maxaverages as the user had it
        Q.w = o.prevW; Q.h = o.prevH
        cam?.resize?.(Q.w / Q.h || 1)
        buildUniforms()
        applySize()                                   // the panel may have moved while we were busy

        /* GIVE THE MEMORY BACK, but only when the render was BIGGER than the live view.
           ensureBuffers never shrinks, so a 4K save otherwise holds its accumulation, frame and
           ray buffers -- which with NEE on runs past two gigabytes -- for the rest of the
           session while the live view uses a fraction of it.

           AND REALLOCATE IMMEDIATELY. releaseBuffers leaves the buffer fields null, and rebind()
           dereferences them unconditionally: setScene and imageStats both reach rebind before
           the next trace would, so a save that ends with the loop paused would leave a renderer
           that throws on the next scene change. The drain is so the freed allocations are
           actually gone rather than co-resident with the new ones. */
        if (o.w * o.h > o.prevW * o.prevH) {
            try {
                await gpu.device.queue.onSubmittedWorkDone()
                RT.releaseBuffers()
                RT.ensureBuffers(Q.w, Q.h)
            } catch (e) { console.error('[pathtracer] buffer release failed', e) }
        }
        await RT.clearAccums()
        Q.resetframecount = 1
        try { COST.reset() } catch { }    // the governor must not steer on 4K timings
        if (o.wasRunning) LOOP.start()
        else present()                    // paused: the canvas was cleared by the resize
    }

    //------------------------------------------------------------------------------------------
    // The public surface
    //------------------------------------------------------------------------------------------
    const api = {
        cost: COST, cam,

        /** The scene changed underneath us; what has accumulated is of a different picture. */
        invalidate() { Q.resetframecount = 1 },

        /** Set any UI-backed uniform by name -- the renderer's own or the scene's -- through the
         *  same path the sliders use. Returns the keys it did not recognise, rather than
         *  swallowing them: a typo that silently does nothing is the worst outcome here. */
        set(values, reset = true) {
            const unknown = []
            for (const [k, v] of Object.entries(values)) {
                const st = allStates().find(s => k in s.values)
                if (st) st.values[k] = v; else unknown.push(k)
            }
            update(reset); onRefresh()
            return unknown
        },
        /** Every UI-backed uniform in one bag, so a harness can put back exactly what it found. */
        get: () => Object.fromEntries(allStates().flatMap(s => Object.entries(s.values))),

        /** THE RENDERER'S SETTINGS AS PARAMETERS, for a host's registry (lib/shell/params.js, the
         *  timeline's contract with a path for an id): asked afresh each time, each set() the way its
         *  slider goes -- the uniforms, its group's reset, the host's refresh. See params.js. */
        parameters() { return settingsParams(states, { update, onRefresh: () => onRefresh(), cam, camFields: CAM_FIELDS }) },

        /** The renderer's OWN settings as plain data, for a host to save with its work: every
         *  group's values, the camera and the size. NOT the scene's uniforms -- get() has those
         *  too, but they are the scene document's (its parameters), and a workspace saved with
         *  them would put one scene's values back over another's on load. */
        settings() {
            const values = structuredClone(Object.fromEntries(Object.values(states).flatMap(s => Object.entries(s.values))))
            return { values, camera: cam ? structuredClone(cam.get()) : null,
                     size: { mode: SIZE.mode, width: SIZE.width, height: SIZE.height, scale: SIZE.scale } }
        },
        /** Put back what settings() gave. Returns the value names it did not recognise -- a file
         *  saved by a renderer with a setting this one has since dropped -- rather than failing
         *  on them; everything it does recognise is applied. */
        applySettings({ values = {}, camera, size } = {}) {
            const known = Object.fromEntries(Object.entries(values).filter(([k]) => Object.values(states).some(s => k in s.values)))
            const unknown = Object.keys(values).filter(k => !(k in known))
            if (camera && cam) {
                /* THE MODE FIRST AND ALONE: cam.set returns straight after a mode change, and
                   ignores the rest of what it was given. Then the pose that mode reads -- an
                   orbit is azimuth, elevation and distance about a target; a free camera is a
                   position and an up. The aspect is not the file's: it is the canvas's. */
                const { mode, camtype, fov, dimensions, target, azimuth, elevation, distance, pos, up, aperture, focus } = camera
                // only what the file has: cam.set tests `'fov' in p`, so an undefined would be set
                const given = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
                try {
                    if (mode) cam.set({ mode })
                    cam.set(given(mode === 'orbit' || mode == null
                        ? { camtype, fov, dimensions, target, azimuth, elevation, distance, aperture, focus }
                        : { camtype, fov, dimensions, target, pos, up, aperture, focus }))
                } catch (e) { console.error('[pathtracer] camera not restored', e) }
            }
            if (size) api.setSize(size)
            for (const [k, v] of Object.entries(known)) allStates().find(s => k in s.values).values[k] = v
            update(); onRefresh()
            return unknown
        },

        /** Swap the scene: recompiles three kernels, returns how long that took. Wraps the
         *  engine's own setScene so the uniform state follows the scene it belongs to. `keepPicture`: the new scene
         *  draws the same picture (the builder's scene baked: builder/baker.js) -- its samples so far are kept. */
        async setScene(s, { keepPicture = false } = {}) {
            /* STOP THE LOOP HERE, not in the caller. A scene swap replaces the pipelines and
               the uniform bag, and there is a window between the two: the pipelines now
               declare the new scene's uniforms while `uniforms` still holds the old scene's.
               A frame submitted in that window writes a name the schema no longer has, and
               tinywebgpu rejects it by name -- `Unknown uniform 'mengerScale'`, thrown out of
               the render loop, which is exactly what a caller who forgot to pause got.

               The Scene page happened to pause before calling this, so the hazard only
               surfaced when a second caller (the scene builder's apply()) did not. That is
               the wrong place for the responsibility: a caller that forgets gets an error
               from two layers down, about a uniform it has never heard of. It belongs here,
               where the window is opened. */
            const wasRunning = LOOP.running()
            LOOP.stop()
            swapping++
            let swapped = false
            try {
                // a build of the kernels' options under way (syncKernels) ends first: one build installs at a time
                if (kernelBuild) { try { await kernelBuild } catch { } }
                /* Stopping only clears a flag the loop tests on entry, so drain what is already
                   submitted before pulling the pipelines out from under it. engineSetScene drains
                   again for its own reasons; both are cheap and neither is redundant, since this
                   one has to happen before the state below changes. */
                try { await gpu.device.queue.onSubmittedWorkDone() } catch { }

                const before = RT.scene
                const ms = await engineSetScene(s, { keepPicture })
                /* CARRY WHAT BOTH SCENES DECLARE. A new scene gets a fresh uniform state, which
                   would mean every setting it shares with the old one snapping back to its
                   default on a switch. That never showed while scene uniforms were only
                   geometry -- mengerScale means nothing to the showcase -- but the material
                   override is a scene uniform now, and it used to be a renderer group that
                   persisted across scene changes. Resetting it on every switch would be a
                   behaviour change smuggled in under a refactor.
                   Matched by NAME: a key the new scene does not declare is dropped, and one it
                   declares with a different default still takes the value the user had set,
                   which is what "my settings stayed" means to the person switching. */
                /* NOT INTO A SCENE WHOSE VALUES ARE ITS OWN (carryUniforms: false -- a document's, whose
                   defaults are the document's values): a name it shares with the scene before is a
                   coincidence of ids, and carrying it moved one scene's objects to the other's places.
                   Unless it is the SAME scene again (recompile()): its defaults are as old as it is, and
                   what was set live since must stay. */
                const prev = sceneState.values
                sceneState = createUniformState(s.uniforms || {})
                carryAcross(prev, sceneState.values, { from: before, to: s })
                update(!keepPicture)           // the bag now matches the pipelines again (the same picture: not started again)
                swapping--; swapped = true
                if (wasRunning) LOOP.start()
                else if (missed && !swapping) { missed = false; present() }   // asked for meanwhile, drawn now
                return ms
            } catch (e) {
                /* A SCENE THAT WOULD NOT BUILD, with the one before it built again (the engine's setScene, `restored`):
                   the uniform state was never replaced, so it is still that scene's, and the loop goes on as it was --
                   the picture it had, not a frozen one. Not restored: nothing presented, the loop left stopped. */
                if (e?.restored) {
                    swapping--; swapped = true
                    update()
                    if (wasRunning) LOOP.start()
                    else if (missed && !swapping) { missed = false; present() }
                }
                throw e
            } finally {
                if (!swapped) swapping--       // a swap that threw: nothing presented, the loop left stopped
            }
        },
        /** What is at a point of the picture: x, y in the ray kernel's [-1, 1], y up (what
         *  genrays.js projectPoint returns). Resolves to { hit, tag, distance, pos, normal } -- the
         *  tag in the scene's own numbering (core/pick.js) -- or null if the scene changed before
         *  the pick kernel for it had compiled. The ray is genrays' own construction without the
         *  jitter, so what is picked is what the pixel's centre shows. */
        async pick(x, y) {
            if (!cam || OFF) return null
            const U = cam.getUniforms()
            const { o, d } = rayThrough(x, y, U, cam.get().camtype ?? 0)
            /* THE RAY IN METRES, THE ANSWER IN THE SCENE'S UNIT (core/units.js): the engine picks in its own, and every
               caller -- the measure tool's pins, the gizmos, a drop, a focus -- works in the scene's numbers */
            const u = uniforms?.sceneUnit || 1
            const r = await enginePick(uniforms, toEngine(o, u), d)
            return r && { ...r, distance: toScene(r.distance, u), pos: toScene(r.pos, u) }
        },
        /** The scene's field or surface colour at many points, for an export to a mesh: `input` as
         *  core/field.js fieldInput() builds it, `outFloats` the f32 to read back. Resolves to a
         *  Float32Array, or null if the scene changed before the kernel for it had compiled. */
        sampleField(input, outFloats) {
            if (OFF || !uniforms) return Promise.resolve(null)
            return RT.field(uniforms, input, outFloats)
        },
        /** WHICH OBJECT'S SURFACE IS NEAREST, at every point of a lattice (core/field.js prog_tagfield):
         *  `input` as fieldInput() builds it in GRID mode. Resolves to { d, tag, tags } -- per point the
         *  nearest tagged surface's distance and its tag, and the list tag k names (tags[k - 1]) -- or
         *  null when the scene changed meanwhile. What the builder's bounds are made from. */
        async sampleTags(input) {
            if (OFF || !uniforms) return null
            const scene = RT.scene, rev = RT.sceneRev
            const out = await RT.tagField(uniforms, input)
            if (!out || RT.scene !== scene || RT.sceneRev !== rev) return null
            const n = out.length / 2, d = new Float32Array(n), tag = new Uint32Array(n)
            const bits = new Uint32Array(out.buffer, out.byteOffset, out.length)
            for (let i = 0; i < n; i++) { d[i] = out[2 * i]; tag[i] = bits[2 * i + 1] }
            return { d, tag, tags: tagFieldTags(scene) }
        },
        /** THE STEP CACHE'S BOX (core/wavefront.js stepCacheWGSL, the developer setting stepCache): `box` { lo, hi } in
         *  the scene's units, or null for none, which leaves the cache inert. The host gives it once its boxes are
         *  measured (the builder: builder/scenedata.js sceneBoxOf). Starts the cache empty and the
         *  picture over. Returns the grid ({ lo, cs, dims }) or null. */
        setStepCacheBox(box) {
            if (OFF) return null
            // cut by the setting's cell count as it stands (a later change cuts it again: R.stepCacheFor)
            const g = engineSetStepCacheBox(box, RT.stepCacheCellsOf(uniforms))
            Q.resetframecount = 1
            return g
        },
        /** WHERE THE PICTURE'S PHOTONS WENT, as lines to paste back: the render size against the ray
         *  budget, light tracing's photons and every other source's (the optics sources) -- asked,
         *  given, and why none (R.photonPlan). A light-traced light missing from the picture has
         *  several causes that look the same on screen; this says which. */
        lightReport() {
            const L = gpu.device?.limits || {}, p = RT.photonPlan, n = v => (+v || 0).toLocaleString('en')
            const lines = [`render ${Q.w} x ${Q.h} = ${n(Q.w * Q.h)} px; ray buffer ${n(RT.raybufferSize)} rays, at most ${n(RT.maxRays)}`,
                           `device: maxStorageBufferBindingSize ${n(L.maxStorageBufferBindingSize)}, maxBufferSize ${n(L.maxBufferSize)}`,
                           `light tracing: caustics (sun, glowing surfaces) ${(uniforms?.lt | 0) ? 'on' : 'off'}, lights' rays ${((uniforms?.lightRays ?? 1) | 0) ? 'on' : 'off'}, ${uniforms?.ltPhotons ?? '?'} photons a pixel`]
            if (!p) lines.push('photons: none planned (the last sample took the path without light tracing, or none has run)')
            else {
                lines.push(`a sample: ${n(p.rays)} camera rays and every photon asked, in ${p.batches} batch${p.batches === 1 ? '' : 'es'} of at most ${n(p.buffer)} rays`)
                lines.push(`  light tracing: asked ${n(p.lt.ask)}, given ${n(p.lt.got)}`)
                for (const s of p.sources)
                    lines.push(`  ${s.name}: asked ${n(s.ask)}, given ${n(s.got)}${s.ready ? '' : ', not ready'}${s.why ? ` -- ${s.why}` : ''}`)
            }
            return lines.join('\n')
        },
        /** What the picture measures at a point: x, y as pick() takes them. Resolves to
         *  { L, se, rel, nEff, count, px, py } -- the pixel's mean luminance in cd/m^2 and its
         *  standard error (core/measure.js), plus E and seE in lux in the illuminance view -- or
         *  null off the picture or where nothing has been sampled. What the HUD's cursor line shows, for a script. */
        async measure(x, y) {
            if (OFF) return null
            const r = await RT.readPixel(Math.floor((x + 1) / 2 * Q.w), Math.floor((y + 1) / 2 * Q.h))
            /* in the illuminance view the pixel holds E/pi, so E and its error are pi times: lux
               on the surface seen there (Measure group, measureMode 1) */
            if (r && (uniforms.measureMode | 0) === 1) Object.assign(r, { E: Math.PI * r.L, seE: r.se != null ? Math.PI * r.se : null })
            return r
        },
        /** What a rectangle of the picture measures: corners (xa, ya) and (xb, yb) as pick() takes
         *  them. Resolves to { mean, se, rel, min, max, uniformity, pixels, sampled, unit } --
         *  cd/m^2 in the picture and the luminance view, lux in the illuminance view (pi times) --
         *  or null. An average over PIXELS: see core/measure.js regionReading for what that means
         *  on a surface seen at an angle, and for when the error bar is null. */
        async measureRegion(xa, ya, xb, yb) {
            if (OFF) return null
            const px = x => Math.floor((x + 1) / 2 * Q.w), py = y => Math.floor((y + 1) / 2 * Q.h)
            const r = await RT.readRegion(px(xa), py(ya), px(xb), py(yb))
            if (!r) return null
            const k = (uniforms.measureMode | 0) === 1 ? Math.PI : 1
            return { ...r, mean: r.mean * k, se: r.se != null ? r.se * k : null, min: r.min * k, max: r.max * k,
                     unit: k === 1 ? 'cd/m\u00b2' : 'lx' }
        },
        /** The uniform values the kernels get this frame -- the settings, the scene's own and the
         *  derived physical ones -- for a module that dispatches kernels of its own against the
         *  same scene (lib/pathtracer/optics). Read-only: change settings through set(). */
        uniformBag: () => uniforms,
        /** EVERY TOLERANCE AND FIXED LENGTH, RESOLVED (core/tolerances.js; lib/pathtracer/PRECISION.md): for the console --
         *  RT.tolerances() at the origin, RT.tolerances([x, y, z]) at a point in the scene's unit, where the f32 floor is
         *  what it is there. { setting, tolerance, floorHere, at, rows: [{ name, times, metres, inSceneUnits, why }] }; metres. */
        tolerances: (at = [0, 0, 0]) => resolveTolerances(uniforms, at.map(x => x * (uniforms?.sceneUnit || 1))),
        /** Whether a scene is being built or swapped in: from a swap's start until the uniform bag matches its
         *  pipelines again (`building` above -- a swap, any build, or before the first has succeeded). setScene
         *  puts the new scene in RT.scene before it builds and its uniforms in the bag after, so a module that
         *  compiles kernels of its own for RT.scene and writes uniformBag() into them can be refused by name in
         *  between (tinywebgpu: "Unknown uniform", when the two scenes' uniforms differ). It waits this out (the
         *  Optics page's Live analysis). */
        sceneBusy: () => !!building(),
        /** Resolves when the kernels are built for the settings as they are (syncKernels above: a feature compiled in
         *  only when on, its setting changed): at once when nothing is left to build. Never rejects -- a build that
         *  failed puts the kernels before back; compare RT.kernelOptionsOf(uniformBag()) with RT.builtOptions. */
        kernelsSettled: () => kernelJob ?? Promise.resolve(),
        /** How many times the picture has been asked to start over (Q.resetframecount set, above): a number that
         *  moves whenever what the picture shows has changed. The Optics page's Live analysis adds rounds to one
         *  estimate while it stands still, and starts a new one when it moves. */
        resets,
        /** Present one frame now if nothing is driving the loop, so a module that draws over the
         *  picture (R.overlays) is seen while paused. A no-op while the loop runs. */
        redraw: () => present(),
        /** Be told how far a scene's compile has got: fn({ done, total, scene }) as each pipeline is
         *  ready, fn({ end: true }) when it is over. Returns the unsubscribe. */
        onCompile(fn) { RT.compileListeners.add(fn); return () => RT.compileListeners.delete(fn) },
        /* (the renderer's own are underscored: this object is Object.assign'ed ONTO the renderer (below), so a
           method here named like one there replaces it -- and calling it recursed. lastCompile, profileCompile and
           recompile, which nothing called, went in 0.22.6: RT._lastCompile is the build's own record) */
        /** CHANGE WHAT THE SCENE SAYS ABOUT ITSELF THAT IS NOT CODE, without a compile: its radius
         *  (scene.envRadius, scene units; null for the 400 m default), its unit and its extent. Written
         *  INTO the scene object the engine holds, never a copy: the engine and the host test
         *  `RT.scene !== scene` to tell a scene change (pick, the culling boxes), and a recompile reuses
         *  the object. THE UNIT AND THE EXTENT ARE HERE SINCE 0.36.0: they were refused ("not values to
         *  drag"), but no text depends on either -- the unit is a uniform, the extent makes the automatic
         *  tolerance -- and the builder applies an edit that leaves the text as it was without a compile
         *  (demo.js sync). So an undone unit change left the engine in the unit it had: every length it
         *  converts a factor of 10 or 1000 out. Returns the keys it refused. */
        updateScene(patch = {}) {
            const LIVE = ['envRadius', 'unit', 'extent']
            const refused = Object.keys(patch).filter(k => !LIVE.includes(k))
            if (!RT.scene) return Object.keys(patch)
            for (const k of LIVE) if (k in patch) RT.scene[k] = patch[k]
            update(); onRefresh()
            return refused
        },
        /** A SCENE WHOSE KERNELS' TEXT IS THE ONE SHOWN, IN ITS PLACE WITHOUT A COMPILE: the builder's scene as data
         *  (builder/scenedata.js), after an edit that adds no code -- a node added, deleted, moved,
         *  given another material. Its records go into the buffer the scene shown made (scene.writeData), and what it
         *  says about itself that is not text (its tags, its extent, its uniforms' values: a builder scene's are its
         *  document's, as setScene gives them) into the object the engine holds -- never a new object: the pick, the
         *  field and the optics module keep their kernels per scene object, and they are the same kernels.
         *  THE TEXT IS CHECKED HERE, every text a kernel compiles and the uniform layout, so a caller that is wrong
         *  about it gets false, not a picture drawn by the wrong kernels. False too when there is no data scene shown
         *  or its buffer has no room: then the caller swaps it in with setScene (the kernels come from the cache). */
        updateSceneData(next) {
            const S = RT.scene
            if (!S?.writeData || !(next?.data instanceof Float32Array)) return false
            if (sceneTextOf(S) !== sceneTextOf(next)) return false
            if (!S.writeData(next.data)) return false
            for (const k of SCENE_DATA_KEYS) if (k in next) S[k] = next[k]
            const fresh = createUniformState(next.uniforms || {}).values
            for (const [k, v] of Object.entries(fresh)) if (k in sceneState.values) sceneState.values[k] = v
            RT.sceneRev++                      // its tags are renumbered: a pick or a box measurement under way is not of this
            RT.clearLight()                    // as setScene: the light map learnt the old shape
            update(); Q.resetframecount = 1; onRefresh()
            return true
        },

        // the loop, opt-in
        start: () => { if (!onScreen) throw new Error('[pathtracer] this renderer has no canvas of its own: render offscreen'); LOOP.start() },
        stop: () => LOOP.stop(),
        running: () => LOOP.running(),
        /** HOLD THE LOOP: it submits no frame until the function returned is called, and stays running --
         *  running() and the play/pause control do not change, and nobody has to remember whether to start
         *  it again (render-loop.js, `held`). For a host about to make the GPU do something it then waits
         *  for (the builder's apply: probe, then setScene); the picture does not move meanwhile. Holds nest;
         *  the release is idempotent, so a finally that runs it twice lets go of one hold, not two.
         *  It holds the LOOP only: a redraw while paused (present) still draws one frame. */
        hold: () => HOLDS.hold(),
        held: () => HOLDS.held(),
        pause: () => LOOP.stop(),
        resume: () => RT.start(),
        step: (n = 1) => LOOP.step(n,
            () => traceOnce(),
            () => gpu.device.queue.onSubmittedWorkDone()),

        update,

        //-------------------------------------------------------------------------------------
        // Size and output
        //-------------------------------------------------------------------------------------
        /** {mode, width, height, scale} plus the resolved `actual` pixels. */
        size: () => ({ ...SIZE, w: Q.w, h: Q.h }),
        /** Change any of mode / width / height / scale and re-resolve. */
        setSize(v = {}) {
            if (OFF) return false
            // only the four settings: size() also reports the resolved w/h, and echoing those
            // back would quietly add dead keys to SIZE
            for (const k of ['mode', 'width', 'height', 'scale']) if (k in v) SIZE[k] = v[k]
            const ch = applySize()
            onRefresh(); if (ch) present()
            return ch
        },

        // the sequencer contract, verbatim -- see OFFSCREEN RENDERING above
        beginOffscreen, renderFrame, grabFrame, endOffscreen,
        /** Whether an offscreen render is under way (from beginOffscreen to endOffscreen): a recording, a save. A
         *  function, not a getter -- the api is copied onto RT (Object.assign), which would freeze a getter's first
         *  answer. What swaps kernels of its own accord waits it out (builder/baker.js: a swap mid-recording would
         *  change the kernels under the frames being filmed). */
        offscreenBusy: () => !!OFF,

        /** Render `samples` samples at `width` x `height` and download a PNG.
         *
         *  ONE SAMPLE IS ONE RAY PER PIXEL AND EVERY PHOTON, AT ANY SIZE (0.38.1). The ray
         *  buffer holds R.maxRays (~2.10 M, raytrace_main.js); a sample with more runs in batches
         *  (core/photons.js planBatches), each the whole wavefront chain. Until then the cap cut
         *  a 4K sample to rays for about a quarter of its pixels and light tracing to no photons
         *  at all, so a large save lost the light only light tracing carries.
         *
         *  What a batch holds is still bounded by the buffer, not by the pixel count, and the
         *  chain is cut into submissions by its share of the frame's time (R.trace, NO SUBMIT
         *  LONG ENOUGH) -- which is why this does not need weavesim's strip rendering to stay
         *  under Windows's two-second command-list watchdog. */
        async saveImage({ width, height, samples = 64, filename = 'render.png', onProgress, signal } = {}) {
            signal?.throwIfAborted()
            await beginOffscreen({ width, height })
            try {
                /* ONE SAMPLE IN FLIGHT: the next is recorded while the GPU runs this one. Awaited one
                   by one, a sample's CPU part and its GPU part ran in turn (measured by the user, Pascal,
                   1280x720, 0.9.2 · e1c7aad, PERFORMANCE_REVIEW.md §10.6: 257.6 -> 225.0 ms a sample in
                   the Noise library, 57.5 -> 42.9 in materials -- before the recording was cut, so what
                   is left to hide is smaller now). The same samples into the same target; gpu.save
                   reads after the last. */
                await renderFrame(samples, onProgress, signal, { inFlight: 2 })
                signal?.throwIfAborted()            // aborted on the last sample: still no file
                // gpu.save owns the 8-bit format check, the BGRA swap and the download; the
                // few lines it shares with grabFrame are the price of each using the right tool
                return await gpu.save(OFF.tex, filename)
            } finally {
                await endOffscreen()
            }
        },

        /** Render `samples` samples at `width` x `height` and KEEP the result as light, in the darkroom
         *  (RT.darkroom, develop.js), to be exposed, tone-mapped and saved after the render:
         *  RT.darkroom.save(settings, filename). Returns what is kept: its size, samples, and `view` -- the
         *  settings the display used for it, which save as the picture saveImage would have written.
         *  Kept BEFORE endOffscreen, while the buffers and the camera are the render's: the copy of the
         *  accumulation, the exposure the display metered (aeState), and the overlays drawn with the render's
         *  camera. */
        async renderPicture({ width, height, samples = 64, onProgress, signal } = {}) {
            signal?.throwIfAborted()
            await beginOffscreen({ width, height })
            try {
                await renderFrame(samples, onProgress, signal, { inFlight: 2 })
                signal?.throwIfAborted()
                const ae = (uniforms.autoExposure | 0) ? await RT.aeState.r(8, 0, Float32Array) : null
                return await DARKROOM.keep({ from: RT.accumulation_u32, w: OFF.w, h: OFF.h, samples,
                                             overlays: RT.overlays || [], view: viewSettings(uniforms, ae) })
            } finally {
                await endOffscreen()
            }
        },
        darkroom: DARKROOM,

        /** Where the live readout renders. A host with no side panel can leave it unset and get
         *  the fixed corner instead. A method, not a setter: the facade is merged onto the engine
         *  with Object.assign, which copies VALUES -- an accessor would be read once and lost. */
        setHud(el) { showFPS.mount = el },

        /** The renderer's own pages. The host builds the shells and says where each page goes,
         *  because a page can belong to a different panel entirely: the renderer's controls
         *  float over the image while the application's stay docked.
         *  @param shell     the default shell
         *  @param pages     {PageName: shell} overrides for pages that live somewhere else
         *  @param sections  {FolderTitle: table} -- finer than pages: one folder of a page placed in
         *                   any property table the host likes (anything with addFolder). The View
         *                   page's Show, Camera and Exposure go to the view's own toolbar this way,
         *                   while its other pages become panels (UI_PLAN.md section 8: a control
         *                   lives with what it changes). The titles: Show, Camera, Exposure,
         *                   Environment, then the Renderer panel's boxes (settingsui.js RENDERER_BOXES:
         *                   Quality, Light sources, Paths and noise, Render size, Ray marching,
         *                   Performance, Diagnostics), Save an image, Tests -- and Developer, the switch's own box,
         *                   only when no Quality box is placed (its foot holds the switch). A host that
         *                   gives none gets the pages (each box names its own). */
        installUI(shell, { onRefresh: refresh, pages = {}, sections = {}, untitled = [], omit = [], build = null } = {}) {
            /* THE ROWS AND WHEN THEY SHOW (settingsui.js, where the headless check builds them too):
               gui.showIf -- a mode switch at the top of a folder, the settings of the other modes
               hidden -- and gui.dev, the Developer switch, as one rule. Re-applied after every
               change and every refresh, so a value set from a script or the bench shows the right
               rows. */
            const baseRefresh = refresh || (() => shell?.refresh())
            // settings the host shows its own way (the view's mode, as icons): no control here as well
            const UI = makeSettingsUI({ states, update, onRefresh: () => baseRefresh(), omit,
                                         lines: { tolerance: () => RT.hud.tolerance?.line ?? '' } })
            onRefresh = () => { baseRefresh(); UI.applyVisibility() }
            const shellFor = name => pages[name] || shell
            /* where one folder goes: its own table if the host placed it, else its page's --
               flat, for an UNTITLED section: a panel or popover of its own already names it
               (sections.js says why) */
            const flat = new Set(untitled)
            const tableOf = (page, section) => sections[section] ? (flat.has(section) ? untitledTable(sections[section]) : sections[section])
                : section in sections ? null           // given as null: the host shows it its own way (or not at all)
                : shellFor(page).page(page)
            const addGroup = (page, title, group, opts) => {
                const table = tableOf(page, title)
                return table ? UI.addGroup(table, title, group, opts) : null
            }
            /* WHAT THE PICTURE SHOWS, first on the View page: photographic, illuminance or luminance.
               Showing illuminance restarts the render, because it changes what is traced (the
               camera's first hit becomes a white surface); the false-colour scale is only display,
               like the exposure, and does not. The group was on no page at all until 2026-09-28:
               the views existed and nothing a person could click reached them. */
            addGroup('View', 'Show', 'Measure')
            if (cam) {
                const camFolder = tableOf('View', 'Camera').addFolder({ title: 'Camera' })
                // what each field is bound to, and how (params.js camBindings: the headless check binds the same)
                cameraControls = new Map(camBindings(cam).map(([k, target, options]) => [k, camFolder.addBinding(target, k, options)]))
            }
            // exposure never restarts the render (GROUP_PARAMS says why)
            const expo = addGroup('View', 'Exposure', 'Exposure')
            // the exposure makes the photographic picture; the false colour is the number itself
            UI.conditional(expo, { group: 'Measure', showIf: { measureMode: [0] } })
            /* METER / LOCK: set the manual exposure from the picture, once, like pressing a
               camera's meter button. With auto-exposure on, that is what it has metered (less
               the compensation) and auto goes off -- "lock exposure", so a walk-through or a
               comparison keeps one EV. With it off, the median luminance of what has
               accumulated, placed at the meter's middle grey (photometry.meterEV100): the median
               rather than the mean because a visible sun is 1.6e9 cd/m^2 and would drag a mean
               to black everywhere else. */
            expo.addButton({ title: 'Meter / lock (set manual EV from the picture)' }).on('click', async () => {
                try {
                    const E = states.Exposure.values
                    let ev = null
                    if ((E.autoExposure | 0) && RT.autoEV != null) ev = RT.autoEV - (+E.exposureComp || 0)
                    else {
                        const st = await RT.imageStats()
                        if (st.median > 0) ev = meterEV100(st.median)
                    }
                    if (ev == null) return
                    E.exposureEV = Math.round(ev * 10) / 10
                    E.autoExposure = 0
                    update(false); onRefresh()
                } catch (e) { console.error('[pathtracer] meter failed', e) }
            })
            // the environment switch (sun and sky, or the studio light) is the first setting here
            addGroup('Light', 'Environment', 'Lighting')
            /* THE RENDERER PANEL'S BOXES (settingsui.js RENDERER_BOXES, which says why boxes and not the schema's
               groups): Quality first -- the presets, renderMode's control -- then the light sources, the paths,
               the render size (this file's own rows), and a developer's two */
            let developer = false
            for (const box of RENDERER_BOXES) {
                const table = tableOf(box.page, box.title)
                if (!table) continue
                if (box.own) { if (box.title === 'Render size') boxIcon(installSizeUI(table), box.icon); continue }
                UI.addBox(table, box)
                if (box.developer) developer = true
            }
            installOutputUI(tableOf('Output', 'Save an image'))
            /* THE DEVELOPER SWITCH: the settings a user has no reason to move (gui.dev) wait behind it at their
               defaults, the Ray marching and Diagnostics boxes with them. Its line is at the Quality box's foot
               (RENDERER_BOXES `developer`); a box of its own only where no Quality box was placed to hold it. */
            if (!developer) UI.installDeveloper(tableOf('Advanced', 'Developer'))
            UI.applyVisibility()
            installTestMenu(tableOf('Tests', 'Tests'), { RT, Q, WG: gpu, COST, build })
        },
    }

    /** Render size, on the Sampling page: it is a quality-versus-speed control before it is
     *  anything else, and that is the page you are on when you are trading those off. */
    function installSizeUI(page) {
        if (!page) return null
        const f = page.addFolder({ title: 'Render size' })
        const reapply = () => { if (applySize()) present(); onRefresh() }
        f.addBinding(SIZE, 'mode', {
            label: 'size', options: { 'fit viewport': 'fit', 'fixed': 'fixed' },
        }).on('change', () => { syncSizeUI(); reapply() })
        // step 2 because an even size is what every video encoder wants, and this is the
        // number a later export would inherit
        const wB = f.addBinding(SIZE, 'width', { min: 16, max: 8192, step: 2 })
        const hB = f.addBinding(SIZE, 'height', { min: 16, max: 8192, step: 2 })
        wB.on('change', reapply); hB.on('change', reapply)
        /* THE DOWNSCALE. The canvas backing store shrinks with it and CSS scales it back up,
           filtered, so the picture stays the same size on screen and only gets softer --
           and a quarter of the pixels is a quarter of the tracing. */
        f.addBinding(SIZE, 'scale', {
            label: 'resolution', options: { '100%': 1, '75%': 0.75, '50%': 0.5, '25%': 0.25 },
        }).on('change', reapply)
        f.addBinding(sizeInfo, 'actual', { readonly: true, label: 'pixels' })
        sizeCtl = { width: wB, height: hB }
        syncSizeUI()
        return f
    }
    /* Width and height mean nothing in fit mode. Hidden rather than disabled, the way the
       camera's controls already come and go with the projection -- see getControlVisibility. */
    let sizeCtl = null
    const syncSizeUI = () => {
        if (!sizeCtl) return
        const fixed = SIZE.mode === 'fixed'
        try { sizeCtl.width.hidden = !fixed; sizeCtl.height.hidden = !fixed } catch { }
    }

    /** Saving, on its own page: it is the one control here that produces a file. RENDER, THEN DEVELOP, THEN SAVE:
     *  the render is kept as light (renderPicture), and its exposure, tone curve and grading are chosen on a preview
     *  before the PNG is written (installDevelopUI) -- they used to be the view's, fixed before the render began. */
    function installOutputUI(page) {
        if (!page) return
        const SV = {
            width: Q.w, height: Q.h, samples: 64,
            matchView: true, status: 'ready', note: '',
        }
        const f = page.addFolder({ title: 'Save an image' })
        /* MATCH THE VIEW'S ASPECT, by default. The camera is rebuilt for whatever aspect the
           save asks for, so a 16:9 save of a square viewport is correctly framed for 16:9 and
           therefore is NOT the picture you were looking at -- you would only find that out
           when the file opened. Locked, width leads and height follows the view; unlocked, the
           note below says plainly that the framing will differ. */
        f.addBinding(SV, 'matchView', { label: 'match view aspect' }).on('change', () => fix())
        const wB = f.addBinding(SV, 'width', { min: 16, max: 16384, step: 2 })
        const hB = f.addBinding(SV, 'height', { min: 16, max: 16384, step: 2 })
        wB.on('change', () => fix()); hB.on('change', () => fix('h'))
        f.addBinding(SV, 'samples', { min: 1, max: 16384, step: 1 }).on('change', () => fix())
        f.addBinding(SV, 'note', { readonly: true, label: '' })
        /* A SAVE IS WHAT THE VIEW IS: a Draft, Sketch or Optics view saves that picture, and lamps
           only saves without the sun (quality.js effective). Said here, before the button, rather than
           found in the file. */
        const asTraced = {}
        Object.defineProperty(asTraced, 'mode', {
            enumerable: true,
            get: () => [['', 'the view is in Draft: so is the picture', 'the view is in Sketch: so is the picture',
                         'the view is in Optics: so is the picture'][uniforms?.renderMode | 0],
                        (states.Tracing.values.lampsOnly | 0) ? 'lamps only: no sun or sky' : '',
                        ((states.Tracing.values.lightRays ?? 1) | 0) === 0 ? 'the lights\' rays off' : ''].filter(Boolean).join('; ') || 'full path tracing',
        })
        f.addBinding(asTraced, 'mode', { readonly: true, label: '' })
        f.addBinding(SV, 'status', { readonly: true, label: '' })
        const useLive = f.addButton({ title: 'Use the live size' })
        useLive.on('click', () => { SV.width = Q.w; SV.height = Q.h; fix() })

        /** Keep the two size fields consistent and say what this size will actually cost. */
        const fix = (lead = 'w') => {
            const ar = (Q.w / Q.h) || 1
            if (SV.matchView) {
                if (lead === 'h') SV.width = Math.max(16, Math.round(SV.height * ar / 2) * 2)
                else SV.height = Math.max(16, Math.round(SV.width / ar / 2) * 2)
            }
            const v = sizeVerdict(SV.width, SV.height)
            if (typeof v === 'string') SV.note = v
            else if (v.batches > 1)
                /* A SAMPLE IN BATCHES (core/photons.js planBatches): every pixel its ray and every photon at this size
                   too, each sample that many runs of the chain, said before the button. It was "N% of pixels per
                   sample": the cap cut the rays, and the photons with them, to none at 2.3 Mpx. */
                SV.note = `a sample in ${v.batches} batches: every pixel, every photon`
            else SV.note = `${(v.total / 1e6) | 0} MB of buffers`
            onRefresh()
        }
        fix()
        const btn = f.addButton({ title: 'Render' })
        /* ABORT, shown only while a render runs. A render holds the renderer (the live view is
           frozen) for as long as its samples take, and a sample count typed a digit too long
           used to mean waiting it out or reloading the page. */
        const stop = f.addButton({ title: 'Abort' })
        stop.hidden = true
        let ctrl = null
        stop.on('click', () => { ctrl?.abort(); stop.disabled = true; SV.status = 'aborting\u2026'; onRefresh() })
        btn.on('click', async () => {
            if (OFF) return
            btn.disabled = true
            ctrl = new AbortController()
            stop.disabled = false; stop.hidden = false
            let done = 0
            try {
                const t0 = performance.now()
                const pic = await api.renderPicture({
                    width: SV.width, height: SV.height, samples: SV.samples,
                    signal: ctrl.signal,
                    onProgress: (i, n) => {
                        done = i
                        // every sample would refresh the pane faster than it can paint
                        if (i === n || i % 8 === 0) { SV.status = `sample ${i} / ${n}`; onRefresh() }
                    },
                })
                SV.status = `rendered in ${((performance.now() - t0) / 1000).toFixed(1)} s`
                develop.rendered(pic)
            } catch (e) {
                // the picture kept before stays kept: a render aborted or failed replaced nothing
                if (e?.name === 'AbortError') SV.status = `aborted after ${done} / ${SV.samples} samples; nothing kept`
                else { console.error('[pathtracer] render failed', e); SV.status = 'FAILED: ' + (e.message || e) }
            } finally {
                ctrl = null
                stop.hidden = true
                btn.disabled = false
                onRefresh()
            }
        })
        const develop = installDevelopUI(f)
    }

    /** DEVELOP: the kept picture on a preview, its exposure, tone curve and grading -- or, for a measuring view, its
     *  false-colour scale -- and Save PNG, at the picture's full size, as often as one likes. The settings start as
     *  the view's for the first picture and are kept for the next (a render again with more samples is the same
     *  print); "As the view showed it" puts back what the display used for the picture now kept. */
    function installDevelopUI(f) {
        const E = UniformGroups.Exposure, M = UniformGroups.Measure
        const DV = { ...viewSettings(uniforms), filename: 'render', status: '' }
        let first = true
        const d = f.addFolder({ title: 'Develop' })
        d.hidden = true

        /* WHAT IT SHOWS: the picture, or its luminance in false colour -- the same light, so either from a render of
           either. Not lux on surfaces: that view traces something else (the first hit made white), so a render of it
           can only be shown as lux, and the choice is hidden. */
        const showB = d.addBinding(DV, 'show', { label: 'show', options: { photographic: 0, 'luminance (cd/m²)': 2 } })
        const evB = d.addBinding(DV, 'ev', { label: 'EV100', min: E.exposureEV.gui.min, max: E.exposureEV.gui.max, step: 0.1 })
        const meterB = d.addButton({ title: 'Meter (EV from the picture)' })
        const toneB = d.addBinding(DV, 'toneMap', { label: 'tone curve', options: E.toneMap.gui.options })
        const grade = ['contrast', 'saturation', 'brightness'].map(k => d.addBinding(DV, k, { min: -1, max: 1, step: 0.01 }))
        const scaleB = [
            d.addBinding(DV, 'measureMin', { label: 'false colour min', min: M.measureMin.gui.min }),
            d.addBinding(DV, 'measureMax', { label: 'false colour max', min: M.measureMax.gui.min }),
            d.addBinding(DV, 'measureBands', { label: 'bands (0 = smooth)', min: 0, max: 40, step: 1 }),
        ]
        const resetB = d.addButton({ title: 'As the view showed it' })
        d.addBinding(DV, 'filename', { label: 'file' })
        const saveB = d.addButton({ title: 'Save PNG' })
        d.addBinding(DV, 'status', { readonly: true, label: '' })
        const discardB = d.addButton({ title: 'Discard the picture' })

        /* THE PREVIEW, at the top of the folder. Put in after the rows: Tweakpane places a row by its index among the
           container's children, so an element of ours there first would have every row added after it go above it.
           A WebGPU canvas of its own on the renderer's device, in the renderer's format (the develop pass's target
           format, as the display's): drawn into directly, nothing read back. */
        const wrap = document.createElement('div')
        Object.assign(wrap.style, { padding: '4px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' })
        const canvas = document.createElement('canvas')
        Object.assign(canvas.style, { display: 'block', background: '#000' })
        // what is kept, under it: a row's value column is too narrow for it
        const caption = document.createElement('div')
        Object.assign(caption.style, { font: '11px var(--sh-mono, ui-monospace, monospace)', color: 'var(--sh-ink, #cfd6dc)', opacity: '0.75' })
        wrap.append(canvas, caption)
        d.element.querySelector('.tp-fldv_c')?.prepend(wrap)
        let ctx = null
        const context = () => {
            if (!ctx) {
                ctx = canvas.getContext('webgpu')
                ctx.configure({ device: gpu.device, format: gpu.format, alphaMode: 'opaque' })
            }
            return ctx
        }
        /* its size: the panel's width, at most 320 CSS pixels high (a tall picture at 420 pushed every control below
           the panel's edge), never more pixels than the picture has */
        const PREVIEW_MAX_H = 320
        const fitCanvas = pic => {
            const dpr = window.devicePixelRatio || 1
            const [pw, ph] = fitPreview(pic.w, pic.h, Math.max(16, wrap.clientWidth - 16) * dpr, PREVIEW_MAX_H * dpr)
            if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph }
            canvas.style.width = `${pw / dpr}px`; canvas.style.height = `${ph / dpr}px`
        }
        /* one redraw a frame, however many changes a slider's drag makes in it; none while the panel is not on screen
           (its width is 0 then) -- the observer below draws when it comes back */
        let queued = false
        const redraw = () => {
            if (queued) return
            queued = true
            requestAnimationFrame(async () => {
                queued = false
                const pic = DARKROOM.picture
                if (!pic || !wrap.clientWidth) return
                fitCanvas(pic)
                try { await DARKROOM.preview(context(), DV) }
                catch (e) { console.error('[pathtracer] develop preview failed', e); DV.status = 'preview FAILED: ' + (e.message || e); onRefresh() }
            })
        }
        try { new ResizeObserver(redraw).observe(wrap) } catch { }

        /* the rows that mean something for what it shows */
        const sync = () => {
            const pic = DARKROOM.picture
            d.hidden = !pic
            if (!pic) return
            showB.hidden = pic.view.show === 1
            const photo = (DV.show | 0) === 0
            for (const b of [evB, meterB, toneB, ...grade]) b.hidden = !photo
            for (const b of scaleB) b.hidden = photo
        }
        const changed = () => { sync(); redraw() }
        for (const b of [showB, evB, toneB, ...grade, ...scaleB]) b.on('change', changed)

        meterB.on('click', async () => {
            try {
                const ev = await DARKROOM.meter()
                if (ev == null) { DV.status = 'black: nothing to meter'; onRefresh(); return }
                DV.ev = Math.round(ev * 10) / 10
                onRefresh(); redraw()
            } catch (e) { console.error('[pathtracer] develop meter failed', e) }
        })
        resetB.on('click', () => {
            const pic = DARKROOM.picture
            if (!pic) return
            Object.assign(DV, pic.view)
            onRefresh(); changed()
        })
        saveB.on('click', async () => {
            const pic = DARKROOM.picture
            if (!pic) return
            saveB.disabled = true
            DV.status = 'saving…'; onRefresh()
            try {
                const name = (DV.filename || 'render').replace(/\.png$/i, '') + '.png'
                await DARKROOM.save(DV, name)
                DV.status = `saved ${name}`
            } catch (e) { console.error('[pathtracer] save failed', e); DV.status = 'FAILED: ' + (e.message || e) }
            finally { saveB.disabled = false; onRefresh() }
        })
        discardB.on('click', () => { DARKROOM.discard(); DV.status = ''; sync(); onRefresh() })

        return {
            /** a new picture kept: the view's settings for the first, or when the kind of picture changed (lux on
             *  surfaces or not), else the ones in use */
            rendered(pic) {
                const lux = pic.view.show === 1
                if (first || lux !== ((DV.show | 0) === 1)) Object.assign(DV, pic.view)
                first = false
                caption.textContent = `${pic.w}×${pic.h}, ${pic.samples} samples · ${Math.ceil(pic.bytes / 1e6)} MB kept on the GPU`
                DV.status = ''
                onRefresh(); changed()
            },
        }
    }

    Object.assign(RT, api)
    return RT
}

