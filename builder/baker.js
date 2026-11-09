//======================================================================================================================
// THE BAKE IN THE BACKGROUND (0.31.0; the user, 2026-10-07: "yes, build the bake mode"). Edit as the builder always
// has -- the scene as data or as code, a value a uniform or a record, nothing compiled for it -- and once the edits
// stop, the same scene with every value a constant (bake.js) is compiled while the picture goes on, and swapped in when
// every kernel is ready, the picture kept: it is the same picture. The first edit after puts the editing build back
// (the builder's apply), from the pipeline cache, so an edit never waits for a compile it did not cause.
//
// WHY: measured on the user's Pascal (0.28.1, roadmap/ARCHITECTURE.md *A bake mode, tested*): baked, the march is 16 to
// 68% faster than codegen's and occlusion 15 to 67%, on seven of the eight bench scenes, and compiling it is no slower.
// What a bake costs is a compile after every edit -- in the background, where nothing waits for it.
//
//   const B = createBaker({ RT, builder, wanted, leave, onShown })
//   B.tick()     the page calls it on a timer: does what is due -- waits for the edits to stop, starts a bake, swaps it
//                in, or (switched off) puts the editing build back
//   B.state      'off' | 'waiting' | 'compiling' | 'shown'
//   B.last       what the last bake came to: { ms, compiled, total, swapMs } or { failed }
//
// WHAT IT ASKS OF THE BUILDER (demo.js): `showing` (the scene being edited is the one shown), `applying`, `revision`
// and `liveEdits` (one more at every recorded edit and every live value: "the edits stopped" is neither moving for
// IDLE_MS), `bakeScene()` (the scene shown, baked: codegen's with its values constants, the culling boxes kept live),
// and `showBaked(scene, still)` (the swap, in the builder's one queue with its applies). OF THE RENDERER: `scene`,
// `precompile(scene)` (raytrace_main.js: the scene's kernels into the pipeline cache, nothing shown) and `sceneBusy()`.
//
// NOT DONE: the culling boxes baked too (they stay uniforms, as the bench measured them); the optics module's kernels
// precompiled (it compiles its own for the baked scene when it next runs).
//======================================================================================================================

/** How long nothing may be edited before a bake starts: the boxes are measured at rest first (app.html, every
 *  half second), and a drag paused for a moment should not start a compile it will throw away. */
export const IDLE_MS = 2000

export function createBaker({ RT, builder, wanted = () => false, leave = () => { }, onShown = () => { }, now = () => performance.now() }) {
    let state = 'off', last = null
    let job = null                       // the bake under way
    let sig = null, quietSince = 0       // the edits as last seen, and since when they have not moved
    let refused = null                   // an edit state that would not bake: not tried again until the edits move
    const signature = () => `${builder.revision}|${builder.liveEdits}|${builder.current}`
    /* NOT DURING AN OFFSCREEN RENDER (RT.offscreenBusy: a recording, a save): the swap would change the kernels under
       the frames being made. It could happen before, with a frame slow enough that no value moved for IDLE_MS (read in
       code, not seen); since a timeline playing ANIMATED values is no edit (demo.js live), the edits stand still all
       through such a recording, and it would. */
    const ready = () => builder.showing && !builder.applying && !RT.sceneBusy?.() && !RT.offscreenBusy?.() && RT.scene?.id === 'built'

    const bake = async (at, editScene) => {
        state = 'compiling'
        let scene
        try { scene = builder.bakeScene() } catch (e) { console.warn('[bake] not baked:', e); refused = at; state = 'waiting'; return }
        if (!scene) { refused = at; state = 'waiting'; return }
        /* EVERY KERNEL INTO THE PIPELINE CACHE FIRST, the edit build still shown: compiled off the thread that paints */
        let r
        try { r = await RT.precompile(scene) }
        catch (e) { console.warn('[bake] a kernel did not compile; the editing build stays:', e?.message ?? e); refused = at; last = { failed: String(e?.message ?? e) }; state = 'waiting'; return }
        /* STILL WHAT WAS BAKED: the same build shown, nothing edited meanwhile, nothing else under way. Otherwise dropped
           -- its kernels stay in the cache, and the next quiet moment bakes again (the same text finds them there). */
        const still = () => wanted() && RT.scene === editScene && signature() === at && ready()
        if (!still()) { state = 'waiting'; return }
        const t0 = now()
        let shown = false
        try { shown = await builder.showBaked(scene, still) }
        catch (e) { console.warn('[bake] the swap failed; the editing build is back:', e?.message ?? e); refused = at; last = { failed: String(e?.message ?? e) }; state = 'waiting'; return }
        if (!shown) { state = 'waiting'; return }
        last = { ...r, swapMs: Math.round(now() - t0) }
        state = 'shown'
        try { onShown(scene, last) } catch (e) { console.warn('[bake] onShown', e) }
    }

    const tick = () => {
        if (job) return                                  // a bake compiling: it looks again when it ends
        const baked = !!RT.scene?.baked
        if (!wanted()) {
            if (baked && builder.showing && !builder.applying) leave()
            state = 'off'; sig = null
            return
        }
        if (baked) { state = 'shown'; return }
        state = 'waiting'
        const s = signature()
        if (s !== sig || !ready()) { sig = ready() ? s : null; quietSince = now(); return }
        if (now() - quietSince < IDLE_MS || refused === s) return
        job = bake(s, RT.scene).finally(() => { job = null })
    }

    return {
        tick,
        get state() { return state },
        get last() { return last },
        /** The bake under way, if any: what a test or a host awaits. */
        get job() { return job },
    }
}
