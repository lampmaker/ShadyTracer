//======================================================================================================================
// THE CAMERA AS ONE VALUE (0.next; lib/pathtracer/params.js CAMERA POSE): `view/camera/pose`, ten numbers -- eye, target,
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

console.log(`campose (the camera as one value): ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
