// node tools/test/timeline.test.mjs
//
// THE TIMELINE'S REGISTRY, without a browser (tools/timeline.js liveRegistry): the parameters as the
// timeline sees them -- the live ones offered, the structural ones (a compile per frame) left out of the
// + track list, skipped when a track names one, and never applied -- and a track on a path moving the
// value, quietly, the way the sequencer plays it. What it looks like and whether it films is the user's.
// And the page's timeline from before 0.67.0 given to the scene shown, once (adoptLegacy).
import { makeParams } from '../../lib/shell/params.js'
import { makeTimeline } from '../../lib/timeline/timeline.js'
import { liveRegistry, adoptLegacy, LEGACY_KEY } from '../timeline.js'

let pass = 0, fail = 0
const eq = (name, got, want) => {
    const a = JSON.stringify(got), b = JSON.stringify(want)
    if (a === b) pass++
    else { fail++; console.log(`FAIL  ${name}\n      got  ${a}\n      want ${b}`) }
}

const S = { flux: 100, pos: [0, 0, 0], shape: 0 }
const log = []
const P = makeParams()
P.provide('scene', () => [
    { path: 'scene/lamp/light/flux', label: 'lamp › flux', min: 0, max: 1000, get: () => S.flux, set: (v, o) => { S.flux = v; log.push(['flux', o?.quiet]) } },
    { path: 'scene/box/transform/position', label: 'box › position', dims: 3, get: () => S.pos, set: v => { S.pos = v } },
    { path: 'scene/box/shape', label: 'box › shape', kind: 'structural', options: { cube: 0, sphere: 1 }, get: () => S.shape, set: v => { S.shape = v } },
])
const R = liveRegistry(P)
const heard = []
P.onChange(e => heard.push([e.path, e.source]))

eq('the + track list: the live parameters only', R.list().map(p => p.id), ['scene/lamp/light/flux', 'scene/box/transform/position'])
eq('a structural one is not there to a track', [R.has('scene/box/shape'), R.get('scene/box/shape'), R.current('scene/box/shape')], [false, undefined, undefined])
eq('a live one is, with its range', [R.has('scene/lamp/light/flux'), R.range(R.get('scene/lamp/light/flux'))], [true, [0, 1000]])
eq('current copies a vector', (() => { const v = R.current('scene/box/transform/position'); v[0] = 9; return S.pos[0] })(), 0)

eq('apply writes the live ones and skips the rest', R.apply({ 'scene/lamp/light/flux': 2000, 'scene/box/shape': 1, 'scene/gone/x': 3 }), ['scene/lamp/light/flux'])
eq('...coerced into its range', S.flux, 1000)
eq('...and the structural one untouched', S.shape, 0)
eq('playing is not an edit: quiet, no undo step', log.at(-1), ['flux', true])
eq('listeners are told the timeline did it', heard.at(-1), ['scene/lamp/light/flux', 'timeline'])

// a track on each, sampled and applied the way the sequencer's seek does
const T = makeTimeline({ fps: 10, duration: 2 })
const tf = T.addTrack('scene/lamp/light/flux', 'linear'); T.setKey(tf, 0, 0); T.setKey(tf, 2, 400)
const tp = T.addTrack('scene/box/transform/position', 'linear'); T.setKey(tp, 0, [0, 0, 0]); T.setKey(tp, 2, [2, 4, 6])
const ts = T.addTrack('scene/box/shape', 'step'); T.setKey(ts, 0, 0); T.setKey(ts, 1, 1)
R.apply(T.sample(1.5))
eq('a track on a light\'s flux moves it', S.flux, 300)
eq('a track on a position moves all three', S.pos, [1.5, 3, 4.5])
eq('a track on a structural parameter (a file from elsewhere) moves nothing', S.shape, 0)

// THE PAGE'S TIMELINE FROM BEFORE 0.67.0 (adoptLegacy): given to the scene shown when it has no tracks of its own,
// taken out of the browser's storage once a scene has it or did not want it, left while none could take it
{
    const store = init => {
        const m = new Map(Object.entries(init))
        return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), has: k => m.has(k) }
    }
    const old = { app: 'timeline', version: 1, timeline: { fps: 10, duration: 2, tracks: [{ prop: 'view/camera/azimuth', interp: 'linear', keys: [{ t: 0, v: 0 }] }] },
                  export: { width: 640, height: 360, format: 'png' } }
    const sceneWith = tracks => ({ timeline: () => ({ fps: 30, duration: 8, tracks, export: {} }) })
    const quiet = console.log; console.log = () => { }
    try {
        let loaded = null
        eq('none kept: nothing done', adoptLegacy({ local: store({}), scene: sceneWith([]), load: o => { loaded = o }, keep: () => true }), 'none')
        eq('...nothing loaded', loaded, null)
        const L = store({ [LEGACY_KEY]: JSON.stringify(old) })
        eq('a scene with no tracks takes it', adoptLegacy({ local: L, scene: sceneWith([]), load: o => { loaded = o }, keep: () => true }), 'kept')
        eq('...loaded into the panel whole, its export settings with it', loaded, old)
        eq('...and gone from the browser\'s storage: given once', L.has(LEGACY_KEY), false)
        const N = store({ [LEGACY_KEY]: JSON.stringify(old) })
        eq('no scene shown to keep it', adoptLegacy({ local: N, scene: sceneWith([]), load: () => { }, keep: () => false }), 'not kept')
        eq('...left for the next start', N.has(LEGACY_KEY), true)
        const O = store({ [LEGACY_KEY]: JSON.stringify(old) })
        loaded = null
        eq('a scene with tracks of its own does not take it', adoptLegacy({ local: O, scene: sceneWith(old.timeline.tracks), load: o => { loaded = o }, keep: () => true }), 'scene has its own')
        eq('...nothing loaded over its own, and it is gone', [loaded, O.has(LEGACY_KEY)], [null, false])
        eq('one that is not JSON is none', adoptLegacy({ local: store({ [LEGACY_KEY]: '{' }), scene: sceneWith([]), load: () => { }, keep: () => true }), 'none')
    } finally { console.log = quiet }
}

console.log(`timeline (the tool's registry): ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
