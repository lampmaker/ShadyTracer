//======================================================================================================================
// THE BAKE IN THE BACKGROUND (builder/baker.js; demo.js bakeScene, showBaked, live). Run:
//   node builder/test/baker.test.mjs
//
// No GPU: whether the baked scene draws what the edit build draws is bake.gpu.mjs's (every camera ray the same), and
// whether it is faster the user's card's (Tests > bake). What is checked here:
//   - the baker over stand-ins, on a clock of its own: nothing while switched off; a bake only once the edits have stood
//     still for IDLE_MS, the scene shown and nothing else under way; compiled, then swapped in; an edit during the
//     compile drops it (no swap), and the next quiet moment bakes again; a bake that will not compile is not tried
//     again until the edits move; switched off with the baked scene shown, the editing build asked back;
//   - the real builder over a stand-in renderer: the scene shown baked (every value a constant but the culling boxes),
//     swapped in with the picture kept; a live value then asks for the editing build back, and the apply that follows
//     shows it with the value; an apply asked during the bake's swap waits for it (one swap at a time).
//======================================================================================================================
import * as M from '../model.js'
import * as P from '../project.js'
import { createBaker, IDLE_MS } from '../baker.js'
import { BAKE_PREFIX } from '../bake.js'

let pass = 0, fail = 0
// straight to stdout: a block below silences console.log while the builder runs, and its failures went with it
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; process.stdout.write(`FAIL  ${name}${extra ? '\n      ' + extra : ''}\n`) }
const tickUntil = async (B, clock, ms, step = 250) => { for (let t = 0; t <= ms; t += step) { clock.t += step; B.tick(); if (B.job) await B.job } }

/* ---- THE BAKER OVER STAND-INS ---- */
{
    const clock = { t: 0 }
    const edit = { id: 'built', title: 'edit' }
    const calls = { bake: 0, pre: 0, show: 0, leave: 0 }
    let gate = null, throwOnce = false
    const builder = { showing: true, applying: false, revision: 1, liveEdits: 0, current: 's1',
                      bakeScene: () => { calls.bake++; return { id: 'built', title: 'baked', baked: { names: ['a'], kept: [] } } },
                      showBaked: async (s, still) => { if (!still()) return false; calls.show++; RT.scene = s; return true } }
    const RT = { scene: edit, sceneBusy: () => false,
                 precompile: async () => { calls.pre++; if (gate) await gate; if (throwOnce) { throwOnce = false; throw new Error('refused') } return { ms: 10, compiled: 3, total: 17 } } }
    let on = false
    const B = createBaker({ RT, builder, wanted: () => on, leave: () => { calls.leave++; RT.scene = edit }, now: () => clock.t })
    await tickUntil(B, clock, 5000)
    ok('switched off: nothing baked, state off', calls.bake === 0 && B.state === 'off', JSON.stringify(calls))
    on = true
    await tickUntil(B, clock, IDLE_MS - 500)
    ok(`on: nothing before the edits have stood still for ${IDLE_MS} ms`, calls.bake === 0 && B.state === 'waiting')
    builder.liveEdits++                                   // a value dragged: the wait starts again
    await tickUntil(B, clock, IDLE_MS - 500)
    ok('...an edit meanwhile starts the wait again', calls.bake === 0)
    await tickUntil(B, clock, IDLE_MS)
    ok('...then baked: compiled, then swapped in, shown', calls.bake === 1 && calls.pre === 1 && calls.show === 1 && RT.scene.baked && B.state === 'shown'
        && B.last?.compiled === 3 && B.last?.total === 17, JSON.stringify([calls, B.state, B.last]))
    await tickUntil(B, clock, 5000)
    ok('...and nothing more while it is shown', calls.bake === 1 && calls.show === 1)
    // an edit: the host puts the editing build back (demo.js live -> an apply); here, as that would
    RT.scene = edit; builder.liveEdits++
    // an edit DURING the compile: dropped, no swap
    let release; gate = new Promise(r => { release = r })
    for (let t = 0; t <= IDLE_MS + 500 && !B.job; t += 250) { clock.t += 250; B.tick() }      // not awaited: it waits on the gate
    await new Promise(r => setTimeout(r, 0))
    const pending = B.job
    ok('a bake compiling', calls.pre === 2 && !!pending && B.state === 'compiling', B.state)
    builder.liveEdits++
    release(); await pending; gate = null
    ok('...an edit while it compiled: dropped, not swapped in, the edit build still shown', calls.show === 1 && RT.scene === edit && B.state === 'waiting')
    await tickUntil(B, clock, IDLE_MS + 500)
    ok('...and the next quiet moment bakes again', calls.pre === 3 && calls.show === 2 && RT.scene.baked)
    // one that will not compile: not tried again until the edits move
    RT.scene = edit; builder.liveEdits++; throwOnce = true
    const warn = console.warn; console.warn = () => { }
    await tickUntil(B, clock, IDLE_MS + 500)
    await tickUntil(B, clock, 5000)
    console.warn = warn
    ok('a bake that would not compile: the edit build stays, not tried again while nothing moves', calls.pre === 4 && RT.scene === edit
        && B.last?.failed === 'refused' && B.state === 'waiting', JSON.stringify([calls, B.last]))
    builder.revision++
    await tickUntil(B, clock, IDLE_MS + 500)
    ok('...an edit, and it is tried again', calls.pre === 5 && RT.scene.baked)
    // nothing while the builder applies, or the scene being edited is not shown, or the renderer builds
    RT.scene = edit; builder.liveEdits++; builder.applying = true
    await tickUntil(B, clock, IDLE_MS * 3)
    builder.applying = false; builder.showing = false
    await tickUntil(B, clock, IDLE_MS * 3)
    builder.showing = true; RT.sceneBusy = () => true
    await tickUntil(B, clock, IDLE_MS * 3)
    RT.sceneBusy = () => false
    RT.offscreenBusy = () => true
    await tickUntil(B, clock, IDLE_MS * 3)
    RT.offscreenBusy = () => false
    ok('nothing while the builder applies, another scene is shown, the renderer builds, or it renders offscreen (a recording)', calls.pre === 5)
    await tickUntil(B, clock, IDLE_MS + 500)
    ok('...and baked once all is quiet', calls.pre === 6 && RT.scene.baked)
    on = false
    B.tick()
    ok('switched off with the baked scene shown: the editing build asked back, once', calls.leave === 1 && RT.scene === edit && B.state === 'off')
    B.tick()
    ok('...and nothing more', calls.leave === 1)
}

/* ---- THE REAL BUILDER OVER A STAND-IN RENDERER ---- */
{
    const WG = { createStorageBuffer: bytes => ({ b: { size: bytes, destroy() { } }, w() { } }), createBuffer: bytes => ({ b: { size: bytes, destroy() { } }, w() { } }) }
    const gpu = { makeCompute: (b, m) => ({ wgsl: `${b}\n${m}`, module: { getCompilationInfo: async () => ({ messages: [] }) }, ready: Promise.resolve() }),
                  makeShader: () => ({ getCompilationInfo: async () => ({ messages: [] }) }), device: { limits: { maxStorageBuffersPerShaderStage: 16 } } }
    let state = { sceneData: 0 }
    const swaps = []
    let hold = null
    const RT = {
        scene: null,
        set(values) { const unknown = []; for (const [k, v] of Object.entries(values)) { if (k in state) state[k] = structuredClone(v); else unknown.push(k) } return unknown },
        get: () => structuredClone(state), settings: () => ({}), applySettings: () => [], updateScene: () => [],
        async setScene(s, opts = {}) {
            swaps.push({ scene: s, keepPicture: !!opts.keepPicture, start: swaps.length })
            if (hold) await hold
            if (s.init) s.buffers = await s.init(WG)
            RT.scene = s
            state = { sceneData: state.sceneData, ...Object.fromEntries(Object.entries(s.uniforms).map(([k, u]) => [k, structuredClone(u.def)])) }
            return 1
        },
    }
    const d = P.blankScene('bake')
    M.addObject(d, 'root', { id: 'ball', primitive: 'sphere' })
    /* the cube in a group: a box test only on a node dearer than its box since 0.34.0 (codegen.js ONLY THE DEAR ONES), and
       two plain shapes at the top level had none to keep */
    M.addGroup(d, 'root', { id: 'held' })
    M.addObject(d, 'held', { id: 'cube', primitive: 'box' })
    const log = console.log; console.log = () => { }
    const { installBuilder } = await import('../demo.js')
    const B = installBuilder({}, { RT, gpu, project: P.createProject([d]) })
    let asked = 0
    B.onRestructure = () => { asked++ }
    await B.apply()
    const edit = RT.scene
    const S = B.bakeScene()
    const all = Object.keys(edit.uniforms), kept = Object.keys(S.uniforms)
    ok('the scene shown, baked: codegen\'s, every value a constant but the culling boxes, its id the builder\'s', S.baked && S.id === 'built'
        && kept.length > 0 && kept.every(n => /^bx(lo|hi)_/.test(n)) && all.filter(n => /^bx(lo|hi)_/.test(n)).every(n => kept.includes(n))
        && S.baked.names.length === all.length - kept.length && S.wgsl.includes(BAKE_PREFIX) && !S.wgsl.includes(`UB.${S.baked.names[0]}`),
        `${kept.length} kept of ${all.length}`)
    ok('...an edit build that is not baked', !edit.baked)
    const shown = await B.showBaked(S, () => true)
    ok('swapped in through the builder: shown, the picture kept (keepPicture)', shown === true && RT.scene === S && swaps.at(-1).keepPicture === true)
    ok('...and it says it is showing (the same scene, its id the builder\'s)', B.showing)
    const n0 = B.liveEdits
    M.find(B.doc, 'ball').node.params.radius = 0.7
    B.live('ball', 'radius')
    ok('a live value with the baked scene shown: the editing build asked back (the host\'s queue), the edit counted', asked === 1 && B.liveEdits === n0 + 1)
    await B.apply()
    ok('...the apply that follows shows the editing build, the value in it, the picture not kept', !RT.scene.baked && swaps.at(-1).keepPicture === false
        && JSON.stringify(state[Object.keys(state).find(k => /radius/.test(k) && /ball/.test(k))]) === '0.7', JSON.stringify(Object.keys(state).filter(k => /ball/.test(k))))
    B.live('ball', 'radius')
    ok('...and a live value then is pushed, nothing asked', asked === 1)
    // NEVER AT ONCE: an apply asked while the bake's swap runs waits for it
    let release; hold = new Promise(r => { release = r })
    const at = swaps.length
    const p1 = B.showBaked(B.bakeScene(), () => true)
    await new Promise(r => setTimeout(r, 0))
    const p2 = B.apply()
    await new Promise(r => setTimeout(r, 0))
    ok('an apply asked during the bake\'s swap: not begun while that runs', swaps.length === at + 1 && B.applying, `${swaps.length - at}`)
    hold = null; release()
    await p1; await p2
    ok('...then it runs, after it: the editing build shown last', swaps.length === at + 2 && swaps[at].keepPicture && !swaps[at + 1].keepPicture && !RT.scene.baked)
    ok('a bake asked when its moment has passed (`still` false): not shown', await B.showBaked(B.bakeScene(), () => false) === false && !RT.scene.baked)
    // ...and the bake's swap not begun while an apply runs: dropped, the apply's scene shown
    hold = new Promise(r => { release = r })
    const n1 = swaps.length
    const p3 = B.apply()
    await new Promise(r => setTimeout(r, 0))
    const dropped = await B.showBaked(B.bakeScene(), () => true)
    hold = null; release(); await p3
    ok('a bake ready while an apply runs: not swapped in (false), the apply\'s scene shown', dropped === false && swaps.length === n1 + 1 && !RT.scene.baked)

    /* ANIMATED VALUES (model.js setAnimated): kept uniforms in the bake, written to it live, the bake staying shown */
    M.setAnimated(B.doc, 'scene/ball/radius', true)
    const SA = B.bakeScene()
    ok('a flagged value: kept a uniform in the bake, read as one', 'radius_ball' in SA.uniforms && SA.baked.kept.includes('radius_ball')
        && SA.wgsl.includes('UB.radius_ball') && !SA.wgsl.includes(`${BAKE_PREFIX}radius_ball`))
    await B.showBaked(SA, () => true)
    const a0 = asked, e0 = B.liveEdits
    M.find(B.doc, 'ball').node.params.radius = 0.4
    B.live('ball', 'radius')
    ok('...moved with the baked scene shown: written to it, the bake stays, no edit counted (the bake need not wait it out)',
        asked === a0 && RT.scene === SA && state.radius_ball === 0.4 && B.liveEdits === e0, JSON.stringify([asked - a0, state.radius_ball, B.liveEdits - e0]))
    M.find(B.doc, 'cube').node.params.size = { x: 0.3, y: 0.3, z: 0.3 }
    B.live('cube', 'size')
    ok('...a value not flagged: the editing build asked back, the edit counted, as before', asked === a0 + 1 && B.liveEdits === e0 + 1)
    await B.apply()
    // a flag added since the bake was made: a constant in it still -- the old way
    const SB = B.bakeScene()
    await B.showBaked(SB, () => true)
    M.setAnimated(B.doc, 'scene/cube/size', true)
    const a1 = asked
    B.live('cube', 'size')
    ok('a value flagged after the bake was made: the editing build asked back (asked of the scene, not the flag)', asked === a1 + 1)
    await B.apply()
    // moved WHILE the bake swaps in: written to the scene it replaced -- pushed again once it is in
    const SC = B.bakeScene()
    hold = new Promise(r => { release = r })
    const p4 = B.showBaked(SC, () => true)
    await new Promise(r => setTimeout(r, 0))
    M.find(B.doc, 'ball').node.params.radius = 0.55
    B.live('ball', 'radius')
    hold = null; release(); await p4
    ok('...moved while the baked scene swapped in: pushed again once it is in', RT.scene === SC && state.radius_ball === 0.55, String(state.radius_ball))

    /* A FLAGGED POSITION DRAGGED (the user, 2026-10-08: "double check that when moving an object that is in the animated
       list, the editor does not switch back"): what the gizmo does at every pointer move (overlay.js place) and the
       panel's position row too -- the transform written, live(id, 'transform'), an undo step -- with the position
       flagged. Rotation and scale are the same matrix (xf_<id>): they stay too. */
    M.setAnimated(B.doc, 'scene/ball/transform/position', true)
    const SD = B.bakeScene()
    ok('a flagged position: the node\'s matrix kept a uniform in the bake', SD.baked.kept.includes('xf_ball') && !SD.wgsl.includes(`${BAKE_PREFIX}xf_ball`))
    await B.showBaked(SD, () => true)
    const a2 = asked, swaps2 = swaps.length, t = M.find(B.doc, 'ball').node.transform
    const xs = []
    for (let i = 1; i <= 5; i++) {
        t.pos.x = 0.1 * i
        B.live('ball', 'transform'); B.commit('ball.transform')
        xs.push(state.xf_ball ? Array.from(state.xf_ball).join() : 'none')
    }
    t.rot.y = 30; B.live('ball', 'transform'); B.commit('ball.transform')
    t.scale = 1.5; B.live('ball', 'transform'); B.commit('ball.transform')
    ok('...dragged five steps, turned and scaled: no editing build asked, nothing swapped, still the baked scene', asked === a2
        && swaps.length === swaps2 && RT.scene === SD && !!RT.scene.baked, JSON.stringify([asked - a2, swaps.length - swaps2]))
    ok('...the matrix written at every step', new Set(xs).size === 5 && !xs.includes('none'), xs.join(' | '))
    ok('...nothing recorded as leaving the bake', B.lastLeave?.scene !== SD)
    // ...and one NOT flagged still leaves, saying why
    M.find(B.doc, 'cube').node.transform.pos.x = 0.2
    B.live('cube', 'transform')
    ok('an object not flagged moved: the editing build asked back, and why recorded', asked === a2 + 1 && B.lastLeave?.scene === SD
        && /not animated/.test(B.lastLeave.why), JSON.stringify(B.lastLeave))
    await B.apply()
    /* (EXACT HITS ON, 0.40.1 to 0.41.0: the bake stood aside, BUILDER.bakeBlocked, since codegen had none and a beam
       grazing the floor vanished once baked. Exact hits went in 0.41.0, and the rule with them: nothing to stand aside for.) */
    ok('no bake-blocking rule left: exact hits are gone (0.41.0)', !('bakeBlocked' in B) && B.bakeScene() !== undefined)
    console.log = log
}

console.log(`baker: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
