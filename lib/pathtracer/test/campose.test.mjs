//======================================================================================================================
// THE CAMERA AS ONE VALUE (0.84.0; lib/pathtracer/params.js CAMERA POSE): `view/camera/pose`, ten numbers -- eye, target,
// up, field of view -- read from and written into the real camera (lib/camera.js), and keyed by the real timeline
// (lib/timeline, which interpolates each number on its own). No GPU, no DOM.
// Run: node lib/pathtracer/test/campose.test.mjs
//======================================================================================================================
import { CAMERA } from '../../camera.js'
import { cameraPose, setCameraPose, settingsParams, CAM_FIELDS, POSE_DIMS } from '../params.js'
import { makeParams } from '../../shell/params.js'
import { makeTimeline } from '../../timeline/timeline.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const near = (a, b, e = 1e-9) => Array.isArray(a) ? a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= e) : Math.abs(a - b) <= e
const fresh = () => {
    const cam = CAMERA({ aspect: 1.5, fov: 40, up: [0, 0, 1] })
    cam.set({ mode: 'orbit', target: [0, 0, 0], azimuth: 40, elevation: 70, distance: 20 })
    return cam
}

{
    const cam = fresh()
    const v = cameraPose(cam)
    ok('ten numbers: eye, target, up, field of view', v.length === POSE_DIMS && near(v.slice(3, 6), [0, 0, 0]) && near(v.slice(6, 9), [0, 0, 1]) && v[9] === 40, JSON.stringify(v))
    ok('...the eye where the orbit puts it', near(Math.hypot(v[0], v[1], v[2]), 20, 1e-9))
    const want = [3, -4, 5, 1, 2, 0.5, 0, 0, 1, 25]
    ok('written into an orbit camera', setCameraPose(cam, want))
    ok('...read back the same', near(cameraPose(cam), want, 1e-9), JSON.stringify(cameraPose(cam)))
    ok('...and it stays an orbit, whose numbers put the eye there (a drag then turns about that target)',
        cam.get().mode === 'orbit' && near(cam.get().distance, Math.hypot(2, -6, 4.5)) && near(cam.get().target, [1, 2, 0.5]))
    cam.set({ mode: 'fps' })
    const free = [10, 0, 1, 0, 0, 1, 0, 0, 1, 50]
    setCameraPose(cam, free)
    ok('a free camera takes the eye as it is', cam.get().mode === 'fps' && near(cameraPose(cam), free), JSON.stringify(cameraPose(cam)))
    const tilted = [10, 0, 1, 0, 0, 1, 0, 1, 1, 50]
    setCameraPose(cam, tilted)
    ok('...an up of any length normalised (an interpolated one is shorter than its keys)', near(cam.get().up, [0, Math.SQRT1_2, Math.SQRT1_2]))
    const was = cameraPose(cam)
    ok('an eye on its target writes nothing', !setCameraPose(cam, [1, 1, 1, 1, 1, 1, 0, 0, 1, 30]) && near(cameraPose(cam), was))
    setCameraPose(cam, [10, 0, 1, 0, 0, 1, 0, 0, 0, 30])
    ok('an up of no length keeps the camera\'s', near(cam.get().up, was.slice(6, 9)) && cam.get().fov === 30)
    ok('not ten finite numbers: nothing', !setCameraPose(cam, [1, 2, 3]) && !setCameraPose(cam, [NaN, 0, 0, 0, 0, 0, 0, 0, 1, 40]))
    setCameraPose(cam, [10, 0, 1, 0, 0, 1, 0, 0, 1, 400])
    ok('a field of view held to what a scene keeps (under 180)', cam.get().fov === 179)
}

// ---- THROUGH THE REGISTRY AND A TIMELINE TRACK: the whole camera keyed, halfway between two keys ----
{
    const cam = fresh()
    const P = makeParams()
    P.provide('renderer', () => settingsParams({}, { update: () => { }, cam, camFields: CAM_FIELDS }))
    const e = P.get('view/camera/pose')
    ok('one entry, live, ten numbers, no range', e && e.kind === 'live' && e.dims === 10 && e.min === undefined && e.max === undefined && e.step === undefined)
    const A = [0, -10, 2, 0, 0, 0, 0, 0, 1, 30], Bk = [10, 0, 4, 2, 2, 0, 0, 0, 1, 50]
    const T = makeTimeline({ fps: 10, duration: 2 })
    const tr = T.addTrack('view/camera/pose', 'linear')
    T.setKey(tr, 0, A); T.setKey(tr, 2, Bk)
    P.apply(T.sample(1))
    const mid = A.map((x, i) => (x + Bk[i]) / 2)
    ok('halfway: the eye and the target halfway along their lines, the field halfway', near(cameraPose(cam), mid, 1e-9), JSON.stringify(cameraPose(cam)))
    P.write('view/camera/pose', Bk)
    ok('written as an edit, the same', near(cameraPose(cam), Bk, 1e-9))
    // a key recorded is the camera as it is (timeline-ui.js keyCurrent: R.current)
    cam.set({ azimuth: 200 })
    ok('a key taken is the camera now', near(P.current('view/camera/pose'), cameraPose(cam)))
}

// THE ROLL (0.85.0; lib/camera.js): the camera's right and up turned about its line of sight in invView, where every
// kernel reads them; the eye, the backward axis and the orbit untouched; its own registry row, not in the pose
{
    const cam = fresh()
    const col = (U, c) => [...U.invView].slice(c * 4, c * 4 + 3)
    const U0 = cam.getUniforms(), x0 = col(U0, 0), y0 = col(U0, 1), z0 = col(U0, 2), e0 = col(U0, 3)
    cam.set({ roll: 30 })
    const U = cam.getUniforms(), c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6)
    ok('roll 30: right is right and up turned by 30 degrees towards up', near(col(U, 0), x0.map((v, i) => v * c + y0[i] * s), 1e-6), JSON.stringify(col(U, 0)))
    ok('...up turned the same way, so the picture turns clockwise', near(col(U, 1), y0.map((v, i) => v * c - x0[i] * s), 1e-6))
    ok('...the backward axis and the eye where they were', near(col(U, 2), z0, 1e-9) && near(col(U, 3), e0, 1e-9))
    ok('...read back, and the pose\'s up still the world\'s', cam.get().roll === 30 && near(cameraPose(cam).slice(6, 9), [0, 0, 1]))
    cam.set({ azimuth: 130 })
    const W = cam.getUniforms(), wz = col(W, 2), wx = col(W, 0)
    const lvl = [-wz[1], wz[0], 0].map(v => v / Math.hypot(wz[0], wz[1]))   // the level right of an orbit there
    ok('an orbit turned with a roll set keeps it: its right 30 degrees off level', near(wx[0] * lvl[0] + wx[1] * lvl[1] + wx[2] * lvl[2], c, 1e-6))
    cam.set({ roll: 0 })
    const V = cam.getUniforms()
    ok('roll 0: the right level again', Math.abs(col(V, 0)[2]) < 1e-9)
    const P = settingsParams({}, { update: () => { }, cam, camFields: CAM_FIELDS })
    const r = P.find(p => p.path === 'view/camera/roll')
    ok('a registry row of its own, written through', r && (r.set(-12), cam.get().roll === -12))
}

// A FREE CAMERA GIVEN A POSE THROUGH set MOVES AT ONCE (0.85.0): until then nothing marked its matrix dirty, and
// invView stayed where the last drag left it
{
    const cam = fresh()
    cam.set({ mode: 'fps' })
    cam.set({ pos: [0, -10, 0], target: [0, 0, 0], up: [0, 0, 1] })
    const U = cam.getUniforms()
    ok('fps: invView\'s eye the position given', near([...U.invView].slice(12, 15), [0, -10, 0], 1e-9), JSON.stringify([...U.invView].slice(12, 15)))
    cam.set({ target: [10, -10, 0] })
    ok('fps: a target alone turns it', near([...cam.getUniforms().invView].slice(8, 11), [-1, 0, 0], 1e-9))
}

console.log(`campose (the camera as one value): ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
