// node tools/test/timeline.test.mjs
//
// THE TIMELINE'S REGISTRY, without a browser (tools/timeline.js liveRegistry): the parameters as the
// timeline sees them -- the live ones offered, the structural ones (a compile per frame) left out of the
// + track list, skipped when a track names one, and never applied -- and a track on a path moving the
// value, quietly, the way the sequencer plays it. What it looks like and whether it films is the user's.
import { makeParams } from '../../lib/shell/params.js'
import { makeTimeline } from '../../lib/timeline/timeline.js'
import { liveRegistry } from '../timeline.js'

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

console.log(`timeline (the tool's registry): ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
