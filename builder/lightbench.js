//======================================================================================================================
// LIGHTBENCH -- the test bench's `light-vs-emitter` row (PLAN.md, *Lights: one model*, L0), whose scene only the
// builder can make: lib/pathtracer/tests.js runs it, the page hands it in (index.html, RTTESTS.addTest -- main's route
// for its benchmark, a button of its own in the Tests panel, not in Run all).
//
// THE QUESTION. Does a light -- the builder's light object, whose light reaches the picture by light tracing alone --
// put the same light into the picture as the same surface made an emissive object, which every camera path counts?
// Both are one two-sided Lambertian disc of the same luminance at the same place, so every row pair must agree. The
// ones that did not were light nothing counted: a light's photons cannot connect through a mirror or glass, gloss
// smoother than roughness 0.224 (LT_MIN_ALPHA) or rough refraction, and a camera path saw a light's face only at its
// first hit. So before L4 the light read low in a mirror, below that roughness, through a pane and behind a diffuser,
// and agreed on a diffuse floor and above the roughness; since L4 (codegen LIGHTS) every pair agrees, L4b and L7
// share what both sides can make, and the rows added for them press those.
//
// THROUGH THE BUILDER'S OWN PATH, not a copy of it: the scene is a document through codegen (the face's rule is the
// one codegen emits), and the light's photons come from its sourceTable entry through faceSource, as the Optics page
// starts them. A hand-written copy of the face rule in tests.js would only test itself.
//
// ONE SCENE, LIVE VISIBILITY (model.js setLiveVisibility): the light, the emissive disc, the pane and the diffuser are
// all compiled and each row shows the ones it needs by a uniform, so the rows run as light / emitter pairs with one
// compile between them all. The floor's material is uniforms too (Lambertian, a mirror, a metal of any roughness).
//
// Also three rows for L3: the light's face seen 56 degrees off its axis, with three distributions -- its luminance
// must follow the distribution (lights.js beamShape), not show the on-axis value from every side.
//======================================================================================================================

import * as M from './model.js'
import { generate } from './codegen.js'
import { sourceTable, faceSource } from './sources.js'
import { lightOf, beamOf, beamShape } from './lights.js'
import { sensorAt, cylinderE } from '../lib/pathtracer/tests.js'
import { fresnel } from '../lib/pathtracer/optics/fresnel.js'
import * as V from '../lib/pathtracer/verdict.js'

/* THE LAMP: a disc of radius R, H up, its faces level, luminance L straight out of both (cd/m^2). Metres. */
const L = 10000, R = 0.3, H = 1
/* ...and A SMALL ONE of the same flux, radius RS: 900 times the luminance, as an LED die is to a panel --
   the light a camera path finds by chance alone (PLAN.md L4b). */
const RS = 0.01, LS = L * (R / RS) ** 2
/* THE CAMERA, above and to the side: it sees the lamp's top face, the floor under the lamp, and the
   lamp's bottom face in a mirror floor -- 34 degrees down onto the disc, 45 onto the floor under it.
   Its position is (3, 0, 3); the pane stands 1 m in front of it, square to the view. */
const TARGET = [0, 0, 0.5], CAM_POS = [3, 0, 3]
const off = CAM_POS.map((c, i) => c - TARGET[i])
const DIST = Math.hypot(...off)
const CAMERA = { mode: 'orbit', camtype: 0, azimuth: 0, elevation: Math.acos(off[2] / DIST) * 180 / Math.PI,
                 distance: DIST, fov: 60, target: TARGET }
const at = (x, y, z, ry = 0) => ({ pos: { x, y, z }, rot: { x: 0, y: ry, z: 0 }, scale: 1 })

/** The bench's document. Exported so check-shaders compiles it: a scene only the bench loads is a
 *  scene nothing else ever checks. */
export function lightBenchDoc() {
    const d = M.createDoc({ title: 'Bench: a light against the same emissive object' })
    M.setLiveVisibility(d, true)
    /* EVERY ID STARTS `bench`: tests.js apply() lays the user's own values under every row by name, so an id the
       user's scene shares takes the user's value -- the demo scene's node `ground` would move this floor
       (xf_ground), and a user's material `glass` would become this pane's glass. */
    // a Lambertian of albedo 0.8 (specular 0: no coat), which the rows turn into a metal
    M.addMaterial(d, { id: 'benchfloor', label: 'floor', params: { baseColor: { r: 0.8, g: 0.8, b: 0.8 }, metallic: 0, roughness: 1,
                                                                specular: 0, transmission: 0, ior: 1.5 } })
    M.addMaterial(d, { id: 'benchglass', label: 'clear glass', preset: 'glass' })
    M.addMaterial(d, { id: 'benchfrost', label: 'rough glass', params: { baseColor: { r: 1, g: 1, b: 1 }, metallic: 0, roughness: 0.5,
                                                                      specular: 0.5, transmission: 1, ior: 1.5 } })
    M.addMaterial(d, { id: 'benchglow', label: 'glowing', type: 'emitter', params: { emissive: { r: 1, g: 1, b: 1 }, emissiveLuminance: L } })
    M.addMaterial(d, { id: 'benchglowsmall', label: 'glowing, small', type: 'emitter',
                       params: { emissive: { r: 1, g: 1, b: 1 }, emissiveLuminance: LS } })
    M.addObject(d, 'root', { id: 'benchground', label: 'floor', primitive: 'plane', material: 'benchfloor' })
    // the same disc twice: a light (two faces, Lambertian, L straight out), and a disc with an emitter material
    M.addLight(d, 'root', { id: 'benchlamp', label: 'the light', shape: 'disc', params: { radius: R }, transform: at(0, 0, H),
                            twoSided: true, luminance: L })
    M.addObject(d, 'root', { id: 'benchdisc', label: 'the emissive disc', primitive: 'disc', material: 'benchglow', params: { radius: R },
                             transform: at(0, 0, H) })
    /* A PANE 1 m in front of the camera, square to its view and wider than it: every pixel is seen through glass.
       4 cm thick: the automatic surface offset here is several millimetres, and a pane thinner than twice it
       would be stepped through before its inside was seen (PLAN.md B5). Turned about y by the camera's angle
       from the vertical, which takes its thin +z along the view. */
    const view = TARGET.map((t, i) => (t - CAM_POS[i]) / DIST)
    M.addObject(d, 'root', { id: 'benchpane', label: 'clear pane', primitive: 'box', material: 'benchglass',
                             params: { size: { x: 1, y: 2, z: 0.02 }, rounding: 0 },
                             transform: at(CAM_POS[0] + view[0], CAM_POS[1] + view[1], CAM_POS[2] + view[2], CAMERA.elevation) })
    // A DIFFUSER over the lamp, between its top face and the camera: rough glass, 4 cm thick for the same reason
    M.addObject(d, 'root', { id: 'benchdiffuser', label: 'diffuser', primitive: 'box', material: 'benchfrost',
                             params: { size: { x: 0.6, y: 0.6, z: 0.02 }, rounding: 0 }, transform: at(0, 0, H + 0.1) })
    /* L4's closed forms. A GLASS BLOCK round the lamp, 0.8 x 0.8 x 0.2 m, its top level 10 cm over the
       lamp: the camera sees the lamp through it, from air, as an LED is seen through its dome. */
    M.addObject(d, 'root', { id: 'benchblock', label: 'glass block', primitive: 'box', material: 'benchglass',
                             params: { size: { x: 0.4, y: 0.4, z: 0.1 }, rounding: 0 }, transform: at(0, 0, H) })
    /* A TRANSPARENT LIGHT where the lamp is (transparency is compiled, not a uniform, so it is a light of
       its own), and AN EMISSIVE DISC BEHIND IT on the camera's line through the lamp's centre, 0.9 m past
       it and square to that line: through the one the camera must see the other. */
    M.addLight(d, 'root', { id: 'benchclear', label: 'a transparent light', shape: 'disc', params: { radius: R },
                            transform: at(0, 0, H), twoSided: true, transparent: true, luminance: L })
    const behind = [0, 0, H].map((c, i) => c - 0.9 * (CAM_POS[i] - [0, 0, H][i]) / Math.hypot(...CAM_POS.map((p, j) => p - [0, 0, H][j])))
    M.addObject(d, 'root', { id: 'benchback', label: 'the disc behind', primitive: 'disc', material: 'benchglow', params: { radius: 0.2 },
                             transform: at(...behind, CAMERA.elevation) })
    // THE SMALL LAMP, twice again: a light and the same disc with an emitter material
    M.addLight(d, 'root', { id: 'benchsmall', label: 'a small light', shape: 'disc', params: { radius: RS }, transform: at(0, 0, H),
                            twoSided: true, luminance: LS })
    M.addObject(d, 'root', { id: 'benchsmalldisc', label: 'the small emissive disc', primitive: 'disc', material: 'benchglowsmall',
                             params: { radius: RS }, transform: at(0, 0, H) })
    /* ...ITS FACE HIDDEN FROM THE CAMERA by a black shade just above it: at 9e6 cd/m^2 the few pixels of
       its top face were two thirds of the picture's mean, and their rims made the pair's ratio a coin
       toss (the first press: 0.97 and 0.93, each pixel's error bar nine times the mean). Wide enough for
       the camera's 56 degrees; the reflection in the floor is of the bottom face, which it does not hide. */
    M.addMaterial(d, { id: 'benchblack', label: 'black', params: { baseColor: { r: 0, g: 0, b: 0 }, metallic: 0, roughness: 1,
                                                                  specular: 0, transmission: 0, ior: 1.5 } })
    M.addObject(d, 'root', { id: 'benchtopshade', label: 'a shade over the small lamp', primitive: 'disc', material: 'benchblack',
                             params: { radius: 0.035 }, transform: at(0, 0, H + 0.012) })
    /* THE USER'S CASE (PLAN.md L7): the small lamp ON EDGE, facing a white wall 1.5 m away, which the
       metal floor reflects to the camera. Below LT_MIN_ALPHA that reflection is the camera's alone --
       floor, then wall, then the lamp -- and before L7 the camera found the lamp from the wall only by
       chance: the lit wall was missing from the reflection below roughness 0.224 and there above it (the
       user, 2026-09-29). Its face towards the camera is shaded, as above; the other cannot show in the
       floor (a ray the floor sends up leaves the camera's side). Twice again, light and emitter. */
    M.addMaterial(d, { id: 'benchwhite', label: 'wall', params: { baseColor: { r: 0.8, g: 0.8, b: 0.8 }, metallic: 0, roughness: 1,
                                                                 specular: 0, transmission: 0, ior: 1.5 } })
    M.addObject(d, 'root', { id: 'benchwall', label: 'a wall', primitive: 'box', material: 'benchwhite',
                             params: { size: { x: 0.02, y: 1, z: 0.75 }, rounding: 0 }, transform: at(-1.5, 0, 0.76) })
    M.addLight(d, 'root', { id: 'benchside', label: 'a small light on edge', shape: 'disc', params: { radius: RS },
                            transform: at(0, 0, H, -90), twoSided: true, luminance: LS })
    M.addObject(d, 'root', { id: 'benchsidedisc', label: 'the small emissive disc on edge', primitive: 'disc', material: 'benchglowsmall',
                             params: { radius: RS }, transform: at(0, 0, H, -90) })
    M.addObject(d, 'root', { id: 'benchsideshade', label: 'a shade beside it', primitive: 'disc', material: 'benchblack',
                             params: { radius: 0.025 }, transform: at(0.012, 0, H, 90) })
    return d
}

/* WHAT EACH ROW SHOWS: the lamp as a light (its photons light the picture) or as the emissive disc, and
   the pane or the diffuser only in their own rows. */
const LIGHT = { vis_benchlamp: 1, vis_benchdisc: 0 }, EMITTER = { vis_benchlamp: 0, vis_benchdisc: 1 }
const PLAIN = { vis_benchpane: 0, vis_benchdiffuser: 0, vis_benchblock: 0, vis_benchclear: 0, vis_benchback: 0,
                vis_benchsmall: 0, vis_benchsmalldisc: 0, vis_benchtopshade: 0,
                vis_benchside: 0, vis_benchsidedisc: 0, vis_benchsideshade: 0, vis_benchwall: 0, measureMode: 0 }
const SMALL_LIGHT = { vis_benchlamp: 0, vis_benchdisc: 0, vis_benchsmall: 1, vis_benchsmalldisc: 0, vis_benchtopshade: 1 }
const SMALL_EMITTER = { vis_benchlamp: 0, vis_benchdisc: 0, vis_benchsmall: 0, vis_benchsmalldisc: 1, vis_benchtopshade: 1 }
const SIDE_LIGHT = { vis_benchlamp: 0, vis_benchdisc: 0, vis_benchside: 1, vis_benchsidedisc: 0, vis_benchsideshade: 1, vis_benchwall: 1 }
const SIDE_EMITTER = { vis_benchlamp: 0, vis_benchdisc: 0, vis_benchside: 0, vis_benchsidedisc: 1, vis_benchsideshade: 1, vis_benchwall: 1 }
/* EVERY PAIR BUT ONE AT A FINE MARCH TOLERANCE. At the automatic one -- 1e-4 of the scene's size,
   0.91 mm here (photometry.js autoEps) -- a ray that passes that close to a surface hits it, so every
   surface is that much fatter to a camera path. For a 1 cm disc that is 1.2x its area: the emissive
   disc, which the camera paths count where they meet it, put 1.2x the light out, while the light's
   photons start on the disc itself -- light/emitter 0.80-0.84 on all four pairs of the fourth press,
   against 0.82 predicted, and 0.99 for the 30 cm disc (0.6% of its area). At 10 um the difference is
   0.2%, and the pairs measure the estimators again. One pair keeps the automatic tolerance, to show it.
   THE 30 CM DISC'S PAIRS TOO (0.79.0). They stayed at the automatic tolerance while the light's face, seen by the
   camera, was as fat as the emitter's: that glowed on the same rim, so the disc in the picture cancelled and the pairs
   read 0.995-1.000. Since a light's face glows on the face alone (codegen.js ONLY ON THE FACE ITSELF), the light is
   exact wherever it is seen and the emitter is not, and at the automatic tolerance those pairs read 0.990-0.994, the
   emitter's excess (Ampere, 2026-10-23, docs/TESTING.md seventh press). That passed only 0.1% inside the 1% floor, and
   it measured the tolerance, which the marker pair already shows. */
const FINE = { eps: 1e-5 }
const LAMBERT = { metallic_benchfloor: 0, specular_benchfloor: 0, roughness_benchfloor: 1 }
const metal = r => ({ metallic_benchfloor: 1, specular_benchfloor: 1, roughness_benchfloor: r })
/* SENSORS on the floor, in the illuminance view, at 0, 0.5 and 1 m from under the lamp: towards the camera and to
   either side, not behind the lamp, which hides part of the floor there. */
const RADII = [0, 0.5, 1]
const BEARINGS = [0, 90, 270]

/** The row, as tests.js takes it. */
export function lightBench() {
    const doc = lightBenchDoc()
    const scene = generate(...M.generateArgs(doc, { id: 'bench-light-emitter', title: 'Bench: light vs emitter' }))
    /* the lamp as the Optics page starts it, with its settings patched -- through the model, so a patch it
       refuses throws here, when the page loads, rather than as a wrong row */
    const lampWith = (patch = {}, id = 'benchlamp') => {
        const d = structuredClone(doc)
        if (Object.keys(patch).length) M.setLight(d, id, patch)
        const x = sourceTable(d).sources.find(s => s.id === id)
        return { source: faceSource(x), beam: beamOf(lightOf(M.find(d, id).node)) }
    }
    const lamp = lampWith()
    const small = lampWith({}, 'benchsmall')
    const side = lampWith({}, 'benchside')
    /* the light's meanLuma, kept for its partner row: `light/emitter` is read on the emitter row */
    const lightMean = new Map()
    const pairOf = (label, set, lightSet, emitterSet, source, more = {}) => [
        { label: `${label} -- light`, set: { ...PLAIN, ...set, ...lightSet }, opticsLight: { perPixel: 1, sources: [source] },
          pair: label, as: 'light', ...more },
        { label: `${label} -- emitter`, set: { ...PLAIN, ...set, ...emitterSet }, pair: label, as: 'emitter', ...more },
    ]
    const pair = (label, set, more) => pairOf(label, set, LIGHT, EMITTER, lamp.source, more)
    const pairSmall = (label, set) => pairOf(label, set, SMALL_LIGHT, SMALL_EMITTER, small.source)
    const pairSide = (label, set) => pairOf(label, set, SIDE_LIGHT, SIDE_EMITTER, side.source)
    /* THE FACE SEEN FROM THE CAMERA, 56 degrees off its axis: the cosine the rows expect the face's luminance at */
    const toCam = CAM_POS.map((c, i) => c - [0, 0, H][i])
    const cosView = toCam[2] / Math.hypot(...toCam)
    const face = (label, patch) => {
        const v = lampWith(patch)
        return { label: `face at ${(Math.acos(cosView) * 180 / Math.PI).toFixed(0)} deg: ${label}`,
                 set: { ...PLAIN, ...LAMBERT, ...LIGHT, beam_benchlamp: v.beam }, opticsLight: { perPixel: 1, sources: [v.source] },
                 faceWant: L * beamShape(v.beam, cosView) }
    }
    const deg = (Math.acos(cosView) * 180 / Math.PI).toFixed(0)
    /* L4, IN THE GLASS IT EMITS INTO (emitN, for its photons): seen from air through the block's level top, at
       the same 56 degrees. Its luminance is its radiance in the glass, and what crosses into air is radiance
       over n^2: L T / n^2, T the top's transmission by the renderer's own Fresnel (optics/fresnel.js, the
       shader's formula). Before L4 no camera path counted a light through glass: 0. */
    // the index is the glass preset's own, read from the document rather than written here twice
    const glassN = doc.materials.find(m => m.id === 'benchglass').params.ior
    const inGlass = (() => {
        const v = lampWith({ emitN: glassN })
        return { label: `face at ${deg} deg, in the glass it emits into (n ${glassN}), seen through its top`,
                 set: { ...PLAIN, ...LAMBERT, ...LIGHT, vis_benchblock: 1, beam_benchlamp: v.beam },
                 opticsLight: { perPixel: 1, sources: [v.source] },
                 faceWant: L * beamShape(v.beam, cosView) * (1 - fresnel(cosView, 1 / glassN).unpolarised) / glassN ** 2 }
    })()
    /* L4, A TRANSPARENT FACE glows and lets the path through: its own L, plus the emissive disc behind it
       (luminance L, seen through a clear sheet: no bend, no reflection). One that still stopped the path, as
       the first look at it once did, reads L. */
    const seeThrough = (() => {
        const v = lampWith({}, 'benchclear')
        return { label: `face at ${deg} deg: transparent, an emissive disc behind it`,
                 set: { ...PLAIN, ...LAMBERT, vis_benchlamp: 0, vis_benchdisc: 0, vis_benchclear: 1, vis_benchback: 1,
                        beam_benchclear: v.beam },
                 opticsLight: { perPixel: 1, sources: [v.source] },
                 faceWant: L * beamShape(v.beam, cosView) + L }
    })()
    return {
        id: 'light-vs-emitter',
        kind: 'image',
        title: 'A light against the same surface made an emissive object: the same picture?',
        /* THE VERDICT (lib/pathtracer/verdict.js; the floors are choices, from the note): each pair's meanLuma, light
           over emitter, 1 within the error bars or 1% -- every pair at 10 um since 0.79.0 (FINE, above) -- except the
           pair kept at the automatic tolerance, the known limit (about 0.82); emitter discovery listing the disc on an
           emitter row and nothing on a light row; the sensors 1 within seMax or 1%; a face its distribution's L
           within 2% of it and 0.2% of the lamp's (the cone's face wants 0). */
        verdict: (r, i, rows, c) => {
            if (!c) return V.info('no case')
            const out = []
            if (c.as === 'emitter') {
                const light = rows.find(x => x.case === `${c.pair} -- light`)
                out.push(!light ? V.info('its light row has not run')
                    : c.pair.includes('the automatic eps') ? V.between(light.meanLuma / r.meanLuma, 0.75, 0.9, 'light/emitter, the known limit')
                    : V.agree(light.meanLuma, r.meanLuma, { seA: V.meanSe(light), seB: V.meanSe(r), floor: 0.01, what: 'light/emitter' }))
            }
            if (c.as && Number.isFinite(r.emitters))
                out.push(c.as === 'emitter' ? V.above(r.emitters, 0, 'emitters listed') : V.exactly(r.emitters, 0, 'emitters listed'))
            if (r.discRatio) out.push(V.sensors(r.discRatio, r.discSe, 0.01, RADII.map(x => `rho ${x}`)))
            if (c.faceWant != null) out.push(V.near(r.faceL, c.faceWant, { floor: 0.02 * c.faceWant + 0.002 * L, what: 'face L' }))
            return out.length ? V.worst(out) : V.info('nothing to judge on this row')
        },
        note: 'PLAN.md, Lights, L0. One two-sided Lambertian disc of 10 000 cd/m^2, 1 m over the floor, once a LIGHT'
            + ' (light-traced: its photons light the picture) and once an EMISSIVE OBJECT (an emitter material:'
            + ' every camera path counts it), sun and sky off. Every pair must agree: `light/emitter` (on the emitter row)'
            + ' is the pair\'s meanLuma ratio and must be 1 within the noise, on EVERY pair since L4. Before it the'
            + ' light read 0.61 in the mirror and at roughness 0.22, 0.53 with the diffuser and 0 through the pane (all'
            + ' of the picture is seen through glass) -- light no strategy counted for a light (PLAN.md finding 1),'
            + ' the step between 0.22 and 0.23 being LT_MIN_ALPHA. Since L4b a light\'s DIRECT reflection is shared'
            + ' between its photons and the camera\'s paths by MIS, so there is no step in the noise either: the 1 cm'
            + ' lamp of the same flux (900 L) over a metal floor at 0.20 and 0.25, its face shaded from the camera, must'
            + ' read 1 with about the same `noise` on both sides. Since L7 the camera\'s paths also aim at a light\'s face'
            + ' past their first surface: the same lamp on edge lighting a wall, which the metal floor reflects -- the'
            + ' user\'s case, dark below 0.224 before L7 -- must read 1 at 0.20 and at 0.25, and the pane\'s light row be'
            + ' about as quiet as its emitter\'s. The 1 cm lamp\'s pairs run at a MARCH TOLERANCE of 10 um (eps): at the'
            + ' automatic one, 0.91 mm here, a ray passing that close to a surface hits it, and the emissive disc -- the'
            + ' reference -- puts out 1.2x the light of the disc the light\'s photons start from. One pair keeps the'
            + ' automatic tolerance to show it: light/emitter about 0.82 (0.80-0.84 on all four pairs before the pin). The'
            + ' 30 cm disc\'s pairs run at 10 um too since 0.79.0: at the automatic tolerance they read 0.990-0.994, the'
            + ' emissive disc 0.6% fatter, once a light\'s face glowed on the face alone (codegen.js ONLY ON THE FACE'
            + ' ITSELF; before it the light\'s face, seen by the camera, was as fat, and they read 0.995-1.000).'
            + ' The illuminance rows read sensors on the floor against'
            + ' the closed form for the disc (tests.js cylinderE, no rim): rho columns 1 within seMax. `emitters` is'
            + ' what emitter discovery listed after the row: at least 1 on an emitter row, 0 on a light row since L1'
            + ' (a light\'s face is not an emitter to look for). The face rows read the'
            + ' light\'s own face, seen 56 degrees off its axis, against its distribution (lights.js beamShape): the'
            + ' Lambertian one shows L, cos^4 shows L cos^3, a 30-degree cone nothing (L3). Two more for L4: the lamp in'
            + ' the glass it emits into, seen through the glass block\'s top, L T / n^2 (radiance over n^2 is what'
            + ' crosses an interface; 0 before L4); a transparent light with an emissive disc behind it, 2 L (its glow'
            + ' and the disc through it; L if it stops the path). The Draft pair on the diffuse floor must read 1 too, and'
            + ' the light in the Optics view (flat light off) against the emitter in Draft: both are the direct light'
            + ' and the face. First press (Ampere, 2026-10-02): 0.9951 and 0.9950, the full pair\'s 0.9953, and the'
            + ' light\'s meanLuma in Draft and Optics within 0.02% of full\'s. (A hair over 1 had been predicted, for'
            + ' Draft\'s emitter lighting the floor a sample late; the runner\'s warm-up lists it first -- clearLearned.)'
            + ' Before 2026-10-02 the light read low in Draft -- inferred from the code, never pressed: its photons kept'
            + ' only their MIS share of the floor\'s direct light. Loads its own scene and camera.',
        delta: 'meanLuma',
        samples: 64,
        scene,
        camera: CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 1, ltPhotons: 1, ltLearn: 1, ltRadius: 15,
               emitRadius: 15, neeEmitShare: 0.5, ltEmitShare: 0.5, envUniform: 0, fireflyClamp: 0, eps: 0,
               sunIlluminance: 0, skyIlluminance: 0, ...PLAIN, ...LAMBERT, beam_benchlamp: lamp.beam, beam_benchsmall: small.beam,
               beam_benchside: side.beam },
        clearLearned: true,
        extra: {
            columns: [
                ['light/emitter', r => r.pairRatio, 4],
                ['emitters', r => r.emitters, 0],
                ...RADII.map((rho, i) => [`rho ${rho}`, r => r.discRatio?.[i] ?? null, 4]),
                ['seMax', r => r.discSe, 4],
                ['face L', r => r.faceL, 0],
                ['face want', r => r.faceWant, 0],
            ],
            read: async (RT, c, ctx, r) => {
                // the list after the row, read and waited for (raytrace_main.js R.readEmitCount says why)
                const out = { emitters: await RT.readEmitCount?.() ?? RT.emitCount }
                if (c.as === 'light') lightMean.set(c.pair, r.meanLuma)
                if (c.as === 'emitter' && lightMean.has(c.pair) && r.meanLuma > 0) out.pairRatio = lightMean.get(c.pair) / r.meanLuma
                if (c.sensors) {
                    // lux in the illuminance view (measureMode 1), which the row is in
                    const discRatio = [], rel = []
                    for (const rho of RADII) {
                        let E = 0, var_ = 0, n = 0
                        for (const ph of rho ? BEARINGS : [0]) {
                            const a = ph * Math.PI / 180
                            const s = await sensorAt(RT, ctx.Q, [rho * Math.cos(a), rho * Math.sin(a), 0])
                            if (!s) continue
                            E += s.E; var_ += s.se ** 2; n++
                        }
                        const want = cylinderE(rho, { L, H, R, T: 0 })
                        discRatio.push(n ? E / n / want : null)
                        if (n) rel.push(Math.sqrt(var_) / n / want)
                    }
                    Object.assign(out, { discRatio, discSe: rel.length ? Math.max(...rel) : null })
                }
                if (c.faceWant != null) {
                    // the face's luminance at its centre, in the picture: a sensor reads pi L
                    const s = await sensorAt(RT, ctx.Q, [0, 0, H])
                    Object.assign(out, { faceL: s ? s.E / Math.PI : null, faceWant: c.faceWant })
                }
                return out
            },
        },
        cases: [
            ...pair('diffuse floor', { ...LAMBERT, ...FINE }),
            ...pair('diffuse floor, illuminance view', { ...LAMBERT, ...FINE, measureMode: 1 }, { sensors: true }),
            /* THE FAST MODES (materials_pbr.js FAST MODES). Draft: the emitter by its light sample at weight 1,
               the light by its photons, which keep the WHOLE of the direct light on the floor -- they kept
               R / (1 + R) of it, the MIS share of a camera path Draft never continues (read in code, not
               measured; most for a big disc like this one). Then the light in the Optics view, flat light
               off, against the emitter in Draft: the same floor light and the same face, nothing else on an
               open floor (the light's black back takes what the floor sends up). Both 0.995 on the first
               press (Ampere, 2026-10-02), as the full pair. */
            ...pair('diffuse floor, Draft', { ...LAMBERT, ...FINE, renderMode: 1 }),
            ...pairOf('diffuse floor: the light in Optics (flat light off), the emitter in Draft', { ...LAMBERT, ...FINE },
                      { ...LIGHT, renderMode: 3, opticsFlat: -12 }, { ...EMITTER, renderMode: 1 }, lamp.source),
            ...pair('mirror floor', { ...metal(0), ...FINE }),
            ...pair('metal floor, roughness 0.22', { ...metal(0.22), ...FINE }),
            ...pair('metal floor, roughness 0.23', { ...metal(0.23), ...FINE }),
            ...pair('through a clear pane', { ...LAMBERT, ...FINE, vis_benchpane: 1 }),
            ...pair('a diffuser over the disc', { ...LAMBERT, ...FINE, vis_benchdiffuser: 1 }),
            ...pairSmall('a 1 cm lamp of the same flux, metal floor, roughness 0.20, eps 10 um', { ...metal(0.20), ...FINE }),
            ...pairSmall('a 1 cm lamp of the same flux, metal floor, roughness 0.25, eps 10 um', { ...metal(0.25), ...FINE }),
            ...pairSmall('a 1 cm lamp of the same flux, metal floor, roughness 0.25, the automatic eps', metal(0.25)),
            ...pairSide('the 1 cm lamp lighting a wall, seen in a metal floor, roughness 0.20, eps 10 um', { ...metal(0.20), ...FINE }),
            ...pairSide('the 1 cm lamp lighting a wall, seen in a metal floor, roughness 0.25, eps 10 um', { ...metal(0.25), ...FINE }),
            face('Lambertian', {}),
            face('cos^4', { n: 4 }),
            face('30-degree cone', { halfAngle: 30 }),
            inGlass,
            seeThrough,
        ],
    }
}
