//======================================================================================================================
// THE PAGE'S START, when the scene it starts on will not compile -- or must not be compiled. index.html calls it; no
// DOM, so test/start.test.mjs runs it in node over stand-ins.
//
// WHY. Since the work is kept in the browser (0.6.0) the scene a page starts on is the user's, as it was left: a
// material half typed, a library item that does not compile. It had always been a bundled scene that compiled. A
// failing first compile threw out of RT.init and stopped the page's script there -- no render loop, no autosave,
// so nothing done afterwards was kept -- and every reload did the same (the user, 2026-10-02). Two answers:
//
//   firstCompile   the renderer's first compile; when it fails, the renderer goes on with an empty scene instead,
//                  the builder is told no scene of the project is showing, and the probe says what is wrong in the
//                  user's terms (validate.js: the node and the line). The page then starts as it always does.
//   safe start     the user's scene not compiled at all, for what firstCompile cannot catch -- a scene that hangs
//                  the GPU or the compiler rather than failing: asked for with ?safe in the address, or taken when
//                  the last start never finished. A mark is set before the first compile and removed once the start
//                  is done (or failed and recovered); still there at the next load, that start was closed,
//                  reloaded or stuck while compiling.
// Either way the scene stays the one worked on, in the tree, and the ▶ over it compiles it.
//======================================================================================================================

export const STARTING_KEY = 'raytracer.starting'

/** Is this a safe start? { safe, asked, unfinished }: `asked` for ?safe in `search`, `unfinished` the mark the last start
 *  left ({ scene, at }) or null. Then the mark is set for this one (`scene` its title). `local` is localStorage, or null. */
export function safeStartOf(local, search = '', scene = '') {
    let unfinished = null
    try { unfinished = JSON.parse(local?.getItem(STARTING_KEY) || 'null') } catch { }
    const asked = new URLSearchParams(search).has('safe')
    try { local?.setItem(STARTING_KEY, JSON.stringify({ scene, at: Date.now() })) } catch { }
    return { safe: asked || !!unfinished, asked, unfinished }
}

/** The start is done: the next one is not a safe start. */
export function started(local) { try { local?.removeItem(STARTING_KEY) } catch { } }

/** What the status says after a safe start. */
export const safeNote = (title, { asked }) => `safe start: '${title}' was not compiled -- ${asked ? 'as asked (?safe)'
    : 'the last start did not finish (closed, reloaded or stuck while compiling it)'}. ▶ on its card over the tree compiles it, or open another scene from its card`

/**
 * THE RENDERER'S FIRST COMPILE (RT.init). Resolves to null when it went well; when it failed, to what to say -- with the
 * renderer on `nothing` (an empty scene, compiled instead) and the builder told no scene of the project is showing.
 *
 * @param RT       the renderer: init, setScene
 * @param BUILDER  builder/demo.js's: unshow, check, doc
 * @param nothing  the empty scene to fall back on (generated, its id not the builder's 'built')
 */
export async function firstCompile({ RT, BUILDER, nothing }) {
    try { await RT.init(); return null }
    catch (e) {
        console.error('[raytracer] the scene being worked on did not compile at start:', e)
        /* init built everything but the scene's kernels before it failed (raytrace_main.js R.init), so a scene swap
           is what is left to do -- onto one that compiles */
        try { await RT.setScene(nothing) } catch (e2) { console.error('[raytracer] not even an empty scene compiled:', e2) }
        BUILDER.unshow()
        let r = null
        try { r = await BUILDER.check({ quiet: true }) } catch { }
        const why = r && !r.ok ? String(r.report ?? '').split('\n').find(l => l.trim())?.trim() : null
        return `'${BUILDER.doc.title}' does not compile${why ? `: ${why}` : ''} -- started on an empty scene. Fix it, or open another scene from its card; ▶ on its card over the tree compiles it`
    }
}
