//======================================================================================================================
// Tests for the parameter registry (lib/shell/params.js) and the renderer's settings in it
// (lib/pathtracer/params.js). No DOM, no GPU. Run: node lib/shell/test/params.test.mjs
// The scene's entries are builder/test/params.test.mjs's.
//======================================================================================================================
import { makeParams, toArray, intoObject } from '../params.js'
import { makeTimeline } from '../../timeline/timeline.js'
import { settingsParams, GROUP_PARAMS, CAM_FIELDS, orbitOf, camPoint } from '../../pathtracer/params.js'
import { CAMERA } from '../../camera.js'
import { UniformGroups, createUniformState } from '../../pathtracer/core/uniforms.schema.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)

//----------------------------------------------------------------------------------------------
// THE REGISTRY on a plain object
//----------------------------------------------------------------------------------------------
{
    const S = { a: 5, n: 2, v: [1, 2, 3], mode: 0 }
    const log = []
    const P = makeParams()
    P.provide('toy', () => [
        { path: 'toy/a', label: 'Alpha', min: 0, max: 10, get: () => S.a, set: (v, o = {}) => { S.a = v; log.push(['a', v, !!o.quiet]) } },
        { path: 'toy/n', label: 'count', min: 1, max: 9, step: 1, get: () => S.n, set: v => { S.n = v } },
        { path: 'toy/v', label: 'vector', dims: 3, min: 0, get: () => S.v, set: v => { S.v = v } },
        { path: 'toy/mode', label: 'mode', options: { off: 0, on: 1 }, get: () => S.mode, set: v => { S.mode = v } },
    ])
    const unbreak = P.provide('broken', () => { throw new Error('boom') })
    const heard = []
    P.onChange(e => heard.push(e))
    const warn = console.error; console.error = () => { }      // the provider that throws, on purpose
    try {
        eq('list: every entry, and a provider that throws costs only its own', P.list().map(p => p.path), ['toy/a', 'toy/n', 'toy/v', 'toy/mode'])
        eq('an entry is a timeline property: id is the path, dims defaults to 1, the provider is its group',
            (({ id, dims, group, kind }) => ({ id, dims, group, kind }))(P.get('toy/a')), { id: 'toy/a', dims: 1, group: 'toy', kind: 'live' })
        eq('write coerces into the range', P.write('toy/a', 99), 10)
        eq('write rounds to the step', P.write('toy/n', 3.4), 3)
        eq('write takes an option to its nearest value', P.write('toy/mode', 0.8), 1)
        eq('an edit is not quiet (it is an undo step)', log.at(-1), ['a', 10, false])
        let threw = false
        try { P.write('toy/nope', 1) } catch { threw = true }
        ok('a path that does not exist throws: a typo must not silently do nothing', threw)
        threw = false
        try { P.write('toy/v', 1) } catch { threw = true }
        ok('a vector needs all its numbers', threw)
        eq('apply returns the known paths only', P.apply({ 'toy/a': 2, 'toy/zzz': 1 }), ['toy/a'])
        eq('apply is quiet (the timeline playing is not an edit)', log.at(-1), ['a', 2, true])
        eq('listeners hear every change, with who made it', heard.map(e => [e.path, e.source]),
            [['toy/a', 'write'], ['toy/n', 'write'], ['toy/mode', 'write'], ['toy/a', 'apply']])
        eq('current copies an array: the caller cannot edit the host through it', (() => { const v = P.current('toy/v'); v[0] = 9; return S.v[0] })(), 1)
        eq('list by prefix', P.list('toy/a').map(p => p.path), ['toy/a'])
        eq('find: a label that starts with the word first', P.find('a').map(p => p.path)[0], 'toy/a')
        eq('find: every word must match', P.find('vec toy').map(p => p.path), ['toy/v'])
        eq('format: an option by its name', P.format(P.get('toy/mode')), 'on')
        eq('parse: an option by its name, any case', P.parse(P.get('toy/mode'), 'OFF'), 0)
        eq('parse: a vector by commas or spaces', P.parse(P.get('toy/v'), '1, 2 3'), [1, 2, 3])
        threw = false
        try { P.parse(P.get('toy/a'), 'lots') } catch { threw = true }
        ok('parse: not a number is refused, not NaN', threw)
    } finally { console.error = warn; unbreak() }

    // THE TIMELINE DRIVES IT UNCHANGED: its model samples a track by path, the registry applies it
    const T = makeTimeline({ fps: 10, duration: 1 })
    const tr = T.addTrack('toy/a', 'linear')
    T.setKey(tr, 0, 0); T.setKey(tr, 1, 8)
    P.apply(T.sample(0.5))
    eq('a timeline track on a path moves the value', S.a, 4)
}

//----------------------------------------------------------------------------------------------
// THE RENDERER'S SETTINGS, from the states createPathTracer makes, with a stand-in camera
//----------------------------------------------------------------------------------------------
{
    const states = Object.fromEntries(Object.keys(GROUP_PARAMS).map(g => [g, createUniformState(UniformGroups[g])]))
    const resets = []
    let refreshed = 0
    const pose = { mode: 'orbit', camtype: 0, azimuth: 30, elevation: 60, distance: 5, fov: 40, dimensions: 2 }
    const cam = { get: () => ({ ...pose }), set: o => Object.assign(pose, o) }
    const camFields = [{ key: 'mode', options: { orbit: 'orbit', fps: 'fps' } }, { key: 'camtype', options: { Perspective: 0, Orthogonal: 1 } },
                       { key: 'azimuth', min: 0, max: 360, step: 0.1 }, { key: 'fov', min: 0.1, max: 90 }]
    const P = makeParams()
    P.provide('renderer', () => settingsParams(states, { update: r => resets.push(r), onRefresh: () => refreshed++, cam, camFields }))

    const withGui = Object.entries(GROUP_PARAMS)
        .flatMap(([g, G]) => Object.entries(UniformGroups[g]).filter(([, sp]) => sp.gui).map(([k]) => `${G.path}/${k}`))
    const paths = P.list().map(p => p.path)
    eq('every setting with a control is a parameter, and nothing else of the groups', paths.filter(p => !p.startsWith('view/camera/')), withGui)
    ok('paths are unique', new Set(paths).size === paths.length)
    eq('the environment is the scene\'s, the exposure the view\'s, sampling the renderer\'s',
        ['scene/environment/sunIlluminance', 'view/exposure/exposureEV', 'renderer/tracing/maxbounce'].map(p => P.has(p)), [true, true, true])

    resets.length = 0
    P.write('renderer/tracing/maxbounce', 12.4)
    eq('a sampling change: rounded to its step, into the uniforms, restarts the render', [states.Tracing.values.maxbounce, resets], [12, [true]])
    resets.length = 0
    P.write('view/exposure/exposureEV', 11)
    eq('an exposure change does not restart the render', resets, [false])
    resets.length = 0
    P.write('view/show/measureBands', 5); P.write('view/show/measureMode', 1)
    eq('in Show only the mode restarts it (it changes what is traced)', resets, [false, true])
    eq('an option is a number', P.format(P.get('view/show/measureMode')), 'lux on surfaces')
    P.write('scene/environment/studioColor', [0.5, 0.25, 2])
    eq('a colour is three numbers, stored as the uniform\'s {r,g,b}', states.Lighting.values.studioColor, { r: 0.5, g: 0.25, b: 2 })
    eq('...and reads back as three', P.read('scene/environment/studioColor'), [0.5, 0.25, 2])
    ok('every change refreshes the host, so its sliders follow', refreshed >= 5, `${refreshed}`)

    eq('the camera: its numbers, not its mode', P.list('view/camera').map(p => p.path), ['view/camera/camtype', 'view/camera/azimuth', 'view/camera/fov'])
    P.write('view/camera/azimuth', 400)
    eq('a camera setting goes through cam.set, in its range', pose.azimuth, 360)
    const T = makeTimeline({ fps: 10, duration: 1 })
    const tr = T.addTrack('view/camera/fov', 'linear')
    T.setKey(tr, 0, 20); T.setKey(tr, 1, 60)
    P.apply(T.sample(0.25))
    eq('a timeline track on the camera turns it', pose.fov, 30)
}

//----------------------------------------------------------------------------------------------
// THE RENDERER'S OWN CAMERA FIELDS: distances are scene units, so a metre scene's close-up is a
// hundredth and a mm scene's overview is thousands. The floor was 1 (a metre scene could not come
// closer than 1 m) and the popover wrote that floor back into the camera on every refresh.
//----------------------------------------------------------------------------------------------
{
    const pose = { mode: 'orbit', camtype: 0, azimuth: 0, elevation: 60, distance: 5, fov: 40, dimensions: 2 }
    const cam = { get: () => ({ ...pose }), set: o => Object.assign(pose, o) }
    const P = makeParams()
    P.provide('renderer', () => settingsParams({}, { update: () => { }, cam, camFields: CAM_FIELDS }))
    P.write('view/camera/distance', 0.02)
    eq('a metre scene\'s camera comes to 2 cm, unrounded', pose.distance, 0.02)
    P.write('view/camera/distance', 0.001)
    eq('...and stops at 1 cm', pose.distance, 0.01)
    P.write('view/camera/distance', 5000)
    eq('a mm scene\'s camera goes to 5 m', pose.distance, 5000)
    P.write('view/camera/dimensions', 0.013)
    eq('the orthographic height is a length like it', pose.dimensions, 0.013)
    eq('the lengths are number boxes in the popover, not seven-decade sliders',
        CAM_FIELDS.filter(f => f.slider === false).map(f => f.key), ['distance', 'dimensions', 'aperture', 'focus'])
    // the lens (0.43.0): two more lengths, in the registry, written through to the camera
    P.write('view/camera/aperture', 0.05)
    P.write('view/camera/focus', 3)
    eq('the lens\'s aperture and focus are the camera\'s', [pose.aperture, pose.focus], [0.05, 3])
}

//----------------------------------------------------------------------------------------------
// THE CAMERA'S POSITION AND TARGET AS NUMBERS (the user, 2026-09-30), on the real lib/camera.js: written the
// way Tweakpane writes a point -- the object read, then its x, y and z assigned
//----------------------------------------------------------------------------------------------
{
    const near = (a, b, e = 1e-6) => a.every((x, k) => Math.abs(x - b[k]) < e)
    const cam = CAMERA({ aspect: 1, fov: 40, up: [0, 0, 1] })
    cam.set({ target: [1, 2, 3] }); cam.set({ azimuth: 30, elevation: 60, distance: 5 })
    const o = orbitOf(cam.get().pos, cam.get().target)
    ok('orbitOf reads back the orbit camera.js made the position from', near([o.azimuth, o.elevation, o.distance], [30, 60, 5]), JSON.stringify(o))
    eq('...an azimuth past 180 comes back in [0, 360)', Math.round(orbitOf([0, -1, 0], [0, 0, 0]).azimuth), 270)
    const pos = camPoint(cam, 'position')
    eq('the position reads as x, y, z', [pos.x, pos.y, pos.z].map(v => +v.toFixed(6)), cam.get().pos.map(v => +v.toFixed(6)))
    const was = cam.get()
    Object.assign(camPoint(cam, 'position'), { x: 10, y: 2, z: 3 })
    ok('a new position moves the eye there and keeps looking at the target', near(cam.get().pos, [10, 2, 3]) && near(cam.get().target, was.target),
        JSON.stringify(cam.get()))
    ok('...as an orbit, so the next drag does not snap back', Math.abs(cam.get().distance - 9) < 1e-9 && Math.abs(cam.get().azimuth) < 1e-9
        && Math.abs(cam.get().elevation - 90) < 1e-9, JSON.stringify(cam.get()))
    cam.set({ azimuth: 90 })
    ok('...and orbiting from there turns about the target at that distance', near(cam.get().pos, [1, 11, 3]), JSON.stringify(cam.get().pos))
    const eye = cam.get().pos
    camPoint(cam, 'target').z = 0
    ok('a new target is looked at from where the eye stands', near(cam.get().target, [1, 2, 0]) && near(cam.get().pos, eye), JSON.stringify(cam.get()))
    camPoint(cam, 'target').x = NaN
    ok('a number that is not one changes nothing', near(cam.get().target, [1, 2, 0]))
    cam.set({ mode: 'fps' })
    camPoint(cam, 'position').y = 4
    ok('a free camera takes the position as it is', Math.abs(cam.get().pos[1] - 4) < 1e-9 && cam.get().mode === 'fps', JSON.stringify(cam.get()))
    const P = makeParams()
    P.provide('renderer', () => settingsParams({}, { update: () => { }, cam, camFields: CAM_FIELDS }))
    ok('position and target are the popover\'s, not the registry\'s', CAM_FIELDS.some(f => f.key === 'position' && f.xyz)
        && !P.list('view/camera').some(e => /target|position/.test(e.path)), P.list('view/camera').map(e => e.path).join(', '))
}

// THE VALUE'S OWN COMPONENTS: a 2D {x, y} is two numbers, and written back it stays 2D (it was read as x, y, z, and
// came back with z = NaN in it -- the builder's pyramid's base was the first {x, y} parameter)
{
    const v2 = { x: 1, y: 2 }, v3 = { x: 1, y: 2, z: 3 }, c = { r: 0.1, g: 0.2, b: 0.3 }, c4 = { r: 0, g: 0, b: 0, a: 1 }
    eq('toArray reads as many components as the value has', [toArray(v2), toArray(v3), toArray(c), toArray(c4)], [[1, 2], [1, 2, 3], [0.1, 0.2, 0.3], [0, 0, 0, 1]])
    intoObject(v2, [5, 6])
    eq('intoObject writes a 2D value back as 2D, the same object', v2, { x: 5, y: 6 })
}

// ONLY THE ANIMATED, WHILE ANY ARE: shown() is what a list offers a person; list() and get() stay whole
{
    const P = makeParams()
    let flag = false
    P.provide('toy', () => [{ path: 'toy/a', get: () => 1, set: () => { } }, { path: 'toy/b', get: () => 2, set: () => { }, animated: flag }])
    ok('none animated: no filter, shown() is list()', !P.anyAnimated() && !P.onlyAnimated() && P.shown().length === 2)
    flag = true
    ok('one animated: on by default, shown() that one, list() still both', P.onlyAnimated() && P.shown().map(p => p.path).join() === 'toy/b' && P.list().length === 2 && P.has('toy/a'))
    P.setOnlyAnimated(false)
    ok('a person\'s choice holds', !P.onlyAnimated() && P.shown().length === 2)
    flag = false
    P.setOnlyAnimated(true)
    ok('on with none animated: everything (nothing to keep the list to)', P.shown().length === 2)
}

console.log(`params (registry, renderer): ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
