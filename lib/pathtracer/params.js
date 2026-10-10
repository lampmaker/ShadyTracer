//======================================================================================================================
// THE RENDERER'S SETTINGS AS PARAMETERS -- entries for an application's parameter registry.
//
//   RT.parameters()   ->  [{ path, label, group, min, max, step, options, dims, kind, get, set }]
//
// The entry is the timeline's property (lib/timeline/registry.js) with a path for its id, which is
// what lib/shell/params.js collects. The renderer does not import the shell: it hands out plain
// entries, and a host that has no registry never calls this.
//
// Pure over the settings it is given, so test/params.test.mjs runs it without a GPU. It was a method
// inside createPathTracer first, where only a browser with a device could ever have executed it --
// "a feature nothing exercises is code that has never run" (CLAUDE.md).
//======================================================================================================================

/* EACH GROUP (uniforms.schema.js UniformGroups): the path its settings live under, its title (a parameter's
   label starts with it), and whether a change restarts the render. ONE TABLE for installUI's rows and for the
   parameters -- the reset rule was an argument at each addGroup call, and a second reader would have
   had to copy it and could have drifted from it. Tracing and Advanced are no folder of their own since 0.16.0:
   their settings are spread over the Renderer panel's boxes (settingsui.js RENDERER_BOXES), each row still
   restarting by its group's rule here.
   The paths say WHAT A SETTING CHANGES (roadmap/UI_PLAN.md section 8), not which page it
   happens to be on: the sun and sky are the scene's, the exposure is the view's. They are ids a
   timeline track or an optimiser saves, so they must not move when a page is rearranged. */
export const GROUP_PARAMS = {
    // what the view shows restarts the render only when it changes what is traced: the mode
    Measure:  { path: 'view/show', title: 'Show', reset: k => k === 'measureMode' },
    // exposure is a transform over an accumulation that is already finished: never a restart
    Exposure: { path: 'view/exposure', title: 'Exposure', reset: false },
    Lighting: { path: 'scene/environment', title: 'Environment', reset: true },
    Tracing:  { path: 'renderer/tracing', title: 'Tracing', reset: true },
    Advanced: { path: 'renderer/advanced', title: 'Normals and diagnostics', reset: true },
}

/* THE CAMERA'S FIELDS: the popover's bindings and the registry's view/camera entries, one table.
   Distances are SCENE UNITS, so a range is a range in metres for one scene and millimetres for the
   next. `distance` was min 1, max 1000: a metre scene could not come closer than 1 m, and a mm scene
   could not go further than 1 m -- and the popover's binding does not only limit the slider, it
   writes the clamped value back into the camera on every refresh, so the wheel's closer pose was
   undone the moment the panel refreshed. Now 1 cm (a metre scene) to 100 km (0.1 km in mm).
   No step on the lengths: a step is a rounding, and it would round the camera on that same write.
   `slider: false` -- seven decades on a linear slider is a slider nobody can use below the top
   one; the popover shows a number box with the floor, the registry keeps the whole range. */
export const CAM_FIELDS = [
    { key: 'mode', view: 'list', options: { orbit: 'orbit', fps: 'fps' } },
    { key: 'camtype', view: 'list', options: { Perspective: 0, Orthogonal: 1 } },
    { key: 'azimuth', min: 0, max: 360, step: .1 },
    { key: 'elevation', min: 0, max: 180, step: .1 },
    { key: 'distance', min: 0.01, max: 100000, slider: false },
    { key: 'fov', min: 0.1, max: 90 },
    // the orthographic view's WIDTH (lib/camera.js: the height is it over the aspect): a length like the distance,
    // and the same trouble at 30
    { key: 'dimensions', min: 0.01, max: 100000, slider: false },
    /* THE LENS (0.43.0; lib/camera.js): its diameter, and the distance it is focused at -- 0 the target's. Lengths in
       scene units, like the distance, so number boxes for the same reason. An aperture of 0 is a pinhole: everything
       sharp, and no photon can find the lens (lib/pathtracer/core/lens.js). Perspective only. */
    { key: 'aperture', min: 0, max: 100000, slider: false },
    { key: 'focus', min: 0, max: 100000, slider: false },
    /* WHERE IT IS AND WHAT IT LOOKS AT, as numbers (the user, 2026-09-30: "add camera xyz (or target xyz)
       ... no sliders, just value"). In scene units. Not the registry's: a timeline turns the orbit's own
       numbers, and a position is three of them at once (camPoint below says how it is written). */
    { key: 'target', xyz: true },
    { key: 'position', xyz: true },
]

/** The orbit that puts a camera at `pos` looking at `target`: { azimuth, elevation, distance }, as
 *  lib/camera.js syncOrbitPose reads them -- elevation from +z (0 straight down on it, 90 level), azimuth
 *  about z from +x, both in degrees, azimuth in [0, 360) as the field's range has it. */
export function orbitOf(pos, target) {
    const d = [pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]]
    const L = Math.hypot(d[0], d[1], d[2])
    if (!(L > 0)) return null
    const deg = 180 / Math.PI
    return { azimuth: ((Math.atan2(d[1], d[0]) * deg) % 360 + 360) % 360,
             elevation: Math.acos(Math.max(-1, Math.min(1, d[2] / L))) * deg, distance: Math.max(0.01, L) }
}

/**
 * A camera point as an { x, y, z } whose components READ AND WRITE THROUGH to the camera, for a Tweakpane
 * binding: Tweakpane writes a point by reading the object and assigning its x, y and z (BindingTarget
 * writeProperty), so a plain copy would take the edit and drop it. `key` is 'target' or 'position'.
 * Each keeps the other where it is: a new position moves the eye and keeps looking at the target; a new
 * target turns the eye towards it from where it stands. In orbit mode both are written as the orbit
 * (orbitOf), since camera.js keeps its pose there and a bare `pos` would snap back at the next drag.
 */
export function camPoint(cam, key) {
    const read = () => { const c = cam.get(); return key === 'target' ? c.target : c.pos }
    const write = (i, v) => {
        if (!Number.isFinite(v)) return
        const c = cam.get(), p = [...read()]
        p[i] = v
        const pos = key === 'target' ? c.pos : p, target = key === 'target' ? p : c.target
        if (c.mode !== 'orbit') return cam.set(key === 'target' ? { target } : { pos })
        const o = orbitOf(pos, target)
        if (o) cam.set(key === 'target' ? { target, ...o } : o)
    }
    const o = {}
    for (const [i, a] of ['x', 'y', 'z'].entries())
        Object.defineProperty(o, a, { enumerable: true, get: () => read()[i], set: v => write(i, +v) })
    return o
}

/**
 * THE CAMERA POPOVER'S BINDINGS: [key, target, options] per CAM_FIELDS entry, for a PropertyTable folder's
 * addBinding -- the target a proxy onto the camera (reads cam.get(), writes cam.set()), a point one that
 * writes through (camPoint). A length spanning decades is a number box, not a slider (CAM_FIELDS says
 * why); a point is three plain numbers, without PropertyTable's per-component sliders.
 */
export function camBindings(cam) {
    const target = new Proxy({}, {
        get: (_, k) => (k === 'target' || k === 'position') ? camPoint(cam, k) : cam.get()[k],
        set: (_, k, v) => (cam.set({ [k]: v }), true),
    })
    /* a point's numbers to four places: Tweakpane otherwise takes its decimals from the first value, and a
       y of 4.1650635095 sat beside an x of 4.75. A format, not a step: a step is a rounding, written back
       into the camera on every refresh (CAM_FIELDS says what that did to the distance). */
    const format = v => String(+v.toFixed(4))
    return CAM_FIELDS.map(({ slider, xyz, ...f }) =>
        [f.key, target, xyz ? { ...f, sliders: false, x: { format }, y: { format }, z: { format } }
            : slider === false ? (delete f.max, f) : f])
}

/**
 * @param states     { [group]: { spec, values } } -- the renderer's uniform states
 * @param update     (reset) => void -- rebuild the uniforms; restart the render if reset and they changed
 * @param onRefresh  () => void -- the host's refresh: the sliders follow a value set from elsewhere
 * @param cam        the camera, or null; camFields its fields ({ key, min, max, step, options })
 */
export function settingsParams(states, { update, onRefresh = () => { }, cam = null, camFields = [] }) {
    const out = []
    for (const [group, G] of Object.entries(GROUP_PARAMS)) {
        const st = states[group]
        if (!st) continue
        for (const [k, sp] of Object.entries(st.spec)) {
            if (!sp.gui) continue                    // no gui block means plumbing, not a setting
            const reset = typeof G.reset === 'function' ? G.reset(k) : G.reset
            const vec = String(sp.type).startsWith('vec3')
            const { label = k, min, max, step, options, help } = sp.gui
            // help: the schema's sentence, the Parameters panel's tooltip as it is the Renderer panel's (settingsui.js)
            out.push({ path: `${G.path}/${k}`, label: `${G.title} › ${label}`, group: G.path, min, max, step, options, help,
                dims: vec ? 3 : 1, kind: 'live',
                get: () => vec ? ['r', 'g', 'b'].map(c => +st.values[k][c]) : st.values[k],
                set: v => { st.values[k] = vec ? { r: v[0], g: v[1], b: v[2] } : v; update(reset); onRefresh() } })
        }
    }
    // the camera as its numbers; its mode is a word, not a value a curve could pass through
    if (cam) for (const f of camFields) {
        if (f.xyz) continue
        if (f.options && Object.values(f.options).some(v => typeof v !== 'number')) continue
        out.push({ path: `view/camera/${f.key}`, label: `Camera › ${f.key}`, group: 'view/camera',
            min: f.min, max: f.max, step: f.step, options: f.options, kind: 'live',
            get: () => cam.get()[f.key], set: v => { cam.set({ [f.key]: v }); onRefresh() } })
    }
    return out
}
