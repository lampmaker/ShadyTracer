//======================================================================================================================
// WHICH BUILD IS SHOWN, as the status bar says it (the user, 2026-10-08: "double check that when moving an object that is
// in the animated list, the editor does not switch back to 'scene as data' mode? It's hard to see any difference. Maybe
// show the render mode in the status bar?"). The baked scene draws what the editing build draws (bake.gpu.mjs: every
// camera ray the same), so nothing in the picture tells them apart: only this does.
//
// PURE: what it is handed, a line and its tooltip. app.html hands it the scene shown, the page's own words for the
// editing build's mode (its modeOf: 'code', 'data', 'data-boxes', ...), the baker's state and the builder's lastLeave.
//======================================================================================================================

const BOX = /^bx(lo|hi)_/

/**
 * @param scene     RT.scene
 * @param mode      the page's word for the build shown when not baked (app.html shownMode)
 * @param showing   whether the scene shown is the builder's current one (BUILDER.showing)
 * @param bakeOn    the renderer's sceneBake setting
 * @param baker     the baker's state: 'off' | 'waiting' | 'compiling' | 'shown'
 * @param lastLeave BUILDER.lastLeave: { at, why } or null
 * @returns { text, title, baked }
 */
export function modeLine({ scene, mode = 'code', showing = true, bakeOn = false, baker = 'off', lastLeave = null } = {}) {
    if (!scene) return { text: '', title: '', baked: false }
    // a scene that is not the builder's (a test scene, the empty one at a safe start): its name, nothing more
    if (scene.id !== 'built' || !showing) return { text: `scene · ${scene.id ?? '?'}`, title: 'A scene that is not the builder\'s: no editing build, no bake', baked: false }
    const left = lastLeave ? `\nLast left the bake ${new Date(lastLeave.at).toLocaleTimeString()}: ${lastLeave.why}` : ''
    if (scene.baked) {
        const live = (scene.baked.kept || []).filter(n => !BOX.test(n)).length
        return { text: `baked${live ? ` · ${live} animated live` : ''}`, baked: true,
                 title: 'Baked: the scene compiled with its values as constants. A value flagged animated (◆) moves it without leaving;'
                      + ' anything else moved goes back to the editing build, and the bake comes again 2 s after the last edit.'
                      + (live ? `\n${live} uniform${live > 1 ? 's' : ''} kept live for the animated values (the culling boxes besides).` : '') + left }
    }
    const tail = !bakeOn ? '' : baker === 'compiling' ? ' · baking…' : ' · bake after 2 s quiet'
    return { text: `editing · ${mode}${tail}`, baked: false,
             title: `The editing build: ${mode === 'code' ? 'the scene compiled as code, its values uniforms' : `the scene as ${mode}: its nodes as records, an edit that adds no code compiles nothing`}.`
                  + (bakeOn ? '\nThe bake (Render settings > Performance) compiles it with its values constant once the edits have stood still for 2 s.' : '\nThe bake is off (Render settings > Performance).') + left }
}
