//======================================================================================================================
// Tests for the unit arithmetic. Run: node lib/pathtracer/core/test/photometry.test.mjs
//
// Every number the renderer now reports in lux or cd/m^2 passes through photometry.js on its way to
// a uniform, and a wrong factor of pi there is a picture that is uniformly 3x too bright and looks
// entirely plausible. So the relations are checked against independent computations rather than
// against themselves: the disc luminance by integrating it back to an illuminance, EV100 against
// the published meter values.
//======================================================================================================================
import {
    Y, LUMA, UNITS, SUN_TINT, SUN_DIAMETER_DEG, sunCone, discLuminance, sunHorizontal,
    ev100ToScale, meterEV100, derive, studioLuminance } from '../photometry.js'
import { DERIVED, UniformSpec } from '../uniforms.schema.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const rel = (name, got, want, tol) =>
    ok(name, Math.abs(got - want) <= tol * Math.abs(want), `got ${got}, want ${want} (rel tol ${tol})`)

// 1. Luminance weights are Rec.709 and sum to 1, so white of Y=1 is (1,1,1).
rel('luma weights sum to 1', LUMA.reduce((a, b) => a + b), 1, 1e-12)
rel('sun tint is normalised to Y = 1', Y(SUN_TINT), 1, 1e-12)

// 2. The disc: integrate L cos(angle from axis) over the cone numerically. That is the
//    illuminance on a surface facing the sun, and it must come back as the En we asked for.
//    Midpoint rule in the polar angle; the azimuth integrates to 2 pi exactly.
const integrateDisc = (L, half, n = 20000) => {
    let E = 0
    const h = half / n
    for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * h
        E += L * Math.cos(t) * Math.sin(t) * h
    }
    return 2 * Math.PI * E
}
for (const deg of [SUN_DIAMETER_DEG, 5, 20, 60]) {
    const c = sunCone(deg)
    const L = discLuminance(100000, c.half)
    rel(`disc of ${deg} deg integrates back to its illuminance`, integrateDisc(L, c.half), 100000, 1e-6)
    rel(`solid angle of ${deg} deg matches 2 pi (1 - cos)`, c.solidAngle, 2 * Math.PI * (1 - Math.cos(c.half)), 1e-6)
    rel(`sin2 of ${deg} deg`, c.sin2, Math.sin(c.half) ** 2, 1e-12)
}
// The real sun: 100 klx from a 0.53-degree disc is about 1.6e9 cd/m^2 -- the textbook figure.
{
    const L = discLuminance(100000, sunCone(SUN_DIAMETER_DEG).half)
    ok('real sun luminance is ~1.6e9 cd/m^2', L > 1.4e9 && L < 1.8e9, `got ${L.toExponential(3)}`)
}
// oneMinusCos keeps its precision where the naive form loses it
{
    const c = sunCone(SUN_DIAMETER_DEG)
    ok('1 - cos(theta) is positive and ~1.07e-5 at the real sun',
        c.oneMinusCos > 1.0e-5 && c.oneMinusCos < 1.1e-5, `got ${c.oneMinusCos}`)
}

// 3. Horizontal illuminance: cosine law, nothing below the horizon.
rel('sun at 30 deg puts half its normal illuminance on the ground', sunHorizontal(100000, 30), 50000, 1e-12)
ok('sun below the horizon puts nothing on the ground', sunHorizontal(100000, -5) === 0)

// 4. EV100 = log2(L * 100 / 12.5): EV 0 is 0.125 cd/m^2, and each stop doubles it.
rel('meter reads EV 0 at 0.125 cd/m^2', meterEV100(0.125), 0, 1e-12)
rel('meter reads EV 15 at 4096 cd/m^2', meterEV100(4096), 15, 1e-12)
rel('EV scale: clipping luminance at EV 15 is 1.2 * 2^15', 1 / ev100ToScale(15), 1.2 * 32768, 1e-12)
{
    // A metered luminance lands at 12.5 / (100 * 1.2) ~ 10.4% of the clip point, which is 18%
    // grey in the sense cameras use (the sRGB curve lifts it to about 0.36 on screen).
    const L = 1234
    const shown = L * ev100ToScale(meterEV100(L))
    rel('a metered luminance displays at 12.5/120 of clipping', shown, 12.5 / 120, 1e-12)
}

// 5. derive(): the bundle the host hands the shader.
{
    const d = derive({ sunIlluminance: 100000, sunDiameter: 0.53, uSunElevation: 45,
                       skyIlluminance: 15000, exposureEV: 15 }, { unit: 'mm', skyRaw: 3 })
    rel('mm scene unit', d.sceneUnit, 0.001, 1e-12)
    rel('sky scale takes the raw GPU irradiance to the setting', d.skyScale * 3, 15000, 1e-12)
    rel('sun disc luminance', d.sunL, discLuminance(100000, sunCone(0.53).half), 1e-12)
    ok('unknown units fall back to metres', derive({}, { unit: 'furlong' }).sceneUnit === 1)
    ok('the sky is dark until it has been measured', derive({ skyIlluminance: 1 }).skyScale === 0)
    ok('the sun goes out once its whole disc is below the horizon',
        derive({ sunIlluminance: 1e5, sunDiameter: 0.53, uSunElevation: -0.3 }).sunL === 0
        && derive({ sunIlluminance: 1e5, sunDiameter: 0.53, uSunElevation: -0.2 }).sunL > 0)
    ok('UNITS are the three the builder offers', Object.keys(UNITS).join() === 'm,cm,mm')
    /* THE TWO LISTS MUST BE ONE. derive() fills the bag; DERIVED is what every kernel declares.
       A key only derive() has is rejected by tinywebgpu at the first dispatch; a key only DERIVED
       has is a uniform that is always zero. */
    ok('derive() produces exactly the uniforms the schema declares',
        Object.keys(d).sort().join() === Object.keys(DERIVED).sort().join(),
        `derive: ${Object.keys(d).sort()}  schema: ${Object.keys(DERIVED).sort()}`)
    ok('and every setting derive() reads is in the schema',
        ['sunIlluminance', 'sunDiameter', 'uSunElevation', 'skyIlluminance', 'exposureEV']
            .every(k => k in UniformSpec))
}

// THE AUTOMATIC TOLERANCE: a share of the scene's size, never coarser than the old fixed 1 mm
{
    const { autoEps } = await import('../photometry.js')
    ok('a 10 cm optic in cm gets 10 microns', Math.abs(autoEps(10, 'cm') - 1e-5) < 1e-12, `${autoEps(10, 'cm')}`)
    ok('the same optic in mm gets the same', Math.abs(autoEps(100, 'mm') - 1e-5) < 1e-12)
    ok('a room keeps its millimetre', autoEps(28.8, 'm') === 1e-3)
    ok('a huge ground slab does not make it coarser', autoEps(424, 'm') === 1e-3)
    ok('a scene that does not say keeps 1 mm', autoEps(null) === 1e-3 && autoEps(undefined, 'mm') === 1e-3)
    /* THE SCENE'S OWN (0.66.0): a tolerance it sets, in its unit, is what the kernels take when the renderer's eps is 0 --
       the picture's and the optics trace's alike (optics/index.js sends eps 0 and the bag's epsAuto) */
    const { sceneEps } = await import('../photometry.js')
    ok('a scene that sets 0.002 mm is traced at 2 um, whatever its size', Math.abs(derive({}, { unit: 'mm', extent: 800, tolerance: 0.002 }).epsAuto - 2e-6) < 1e-15)
    ok('...one that sets none at its automatic one', derive({}, { unit: 'mm', extent: 800 }).epsAuto === autoEps(800, 'mm')
        && sceneEps(0, 800, 'mm') === autoEps(800, 'mm') && sceneEps(null, 800, 'mm') === autoEps(800, 'mm'))
    ok('...and its own is not capped by the automatic one\'s 1 mm: a room may ask for 2 mm', Math.abs(sceneEps(2, 20, 'mm') - 2e-3) < 1e-15)
}

// THE SCENE'S RADIUS: its own, in its units, reaching the shader in metres; 400 m when it says none
{
    const { envRadiusMetres, ENV_RADIUS_DEFAULT_M } = await import('../photometry.js')
    ok('25 cm in a cm scene reaches the shader as 0.25 m', Math.abs(derive({}, { unit: 'cm', envRadius: 25 }).envRadius - 0.25) < 1e-15)
    ok('the same radius in mm is the same length', Math.abs(envRadiusMetres(250, 'mm') - 0.25) < 1e-15)
    ok('a scene that says none gets 400 m, in any unit', ENV_RADIUS_DEFAULT_M === 400
        && derive({}).envRadius === 400 && derive({}, { unit: 'mm' }).envRadius === 400 && derive({}, { unit: 'cm', envRadius: null }).envRadius === 400)
    ok('nonsense is the default, never a radius of 0 that would end every ray at once',
        [0, -5, NaN, Infinity, '25'].every(r => envRadiusMetres(r, 'm') === 400))
    ok('no setting called envRadius any more: the scene\'s, not the renderer\'s', !('envRadius' in UniformSpec) && 'envRadius' in DERIVED)
}

// THE SUN'S PHOTON SQUARE AND THE EMITTER SEARCH: their settings, never wider than the scene's radius, in METRES -- the
// engine's unit since 0.36.0 (in scene units before: a mm scene's 15 m square was 15 000)
{
    const { photonHalf } = await import('../photometry.js')
    const d = (v, o) => derive({ ltRadius: 15, emitRadius: 15, ...v }, o)
    ok('a scene with the default radius keeps the 15 m settings, as every scene before (in m)', d({}, {}).ltHalf === 15 && d({}, {}).emitHalf === 15)
    ok('...the same 15 m in a mm scene: metres, whatever the unit', d({}, { unit: 'mm' }).ltHalf === 15 && d({}, { unit: 'mm' }).emitHalf === 15)
    const s = d({}, { unit: 'cm', envRadius: 25 })
    ok('a 25 cm scene: the square and the grid 25 cm, 0.25 m', Math.abs(s.ltHalf - 0.25) < 1e-12 && Math.abs(s.emitHalf - 0.25) < 1e-12, JSON.stringify([s.ltHalf, s.emitHalf]))
    ok('a setting below the radius still wins (the bench\'s square of 0.5 m)', d({ ltRadius: 0.5 }, { unit: 'm', envRadius: 100 }).ltHalf === 0.5)
    ok('each its own setting', d({ ltRadius: 2, emitRadius: 3 }, {}).ltHalf === 2 && d({ ltRadius: 2, emitRadius: 3 }, {}).emitHalf === 3)
    ok('a setting of nothing is the old 1 mm floor, never 0', photonHalf(0, 400) === 1e-3 && photonHalf(NaN, 400) === 1e-3)
    // THE BOUNDARY'S FACTORS (scene_api.js SCENE_BOUNDARY): metres per unit and units per metre, the second exact in f32
    for (const [unit, m, per] of [['m', 1, 1], ['cm', 0.01, 100], ['mm', 0.001, 1000]]) {
        const D = derive({}, { unit })
        ok(`${unit}: sceneUnit ${m} and perMetre ${per}, exactly -- what the shader multiplies by`, D.sceneUnit === m && D.perMetre === per && Math.fround(D.perMetre) === per)
    }
    ok('derive without the settings takes the schema\'s defaults', derive({}).ltHalf === UniformSpec.ltRadius.def && derive({}).emitHalf === UniformSpec.emitRadius.def)
    ok('the aim margin is a developer setting, automatic by default', UniformSpec.emitMargin?.def === 0 && UniformSpec.emitMargin.gui?.dev === true)
}

{
    /* THE STUDIO LIGHT: L0 (1 + top z) integrated with its cosine over the upper hemisphere must
       give the illuminance set, for any top share; midpoint rule in z = cos(theta), where the
       measure is 2 pi dz, so E = 2 pi integral of L(z) z dz from 0 to 1 */
    for (const top of [0, 0.5, 1]) {
        const [L0] = studioLuminance(2000, top)
        const N = 100000
        let E = 0
        for (let i = 0; i < N; i++) { const z = (i + 0.5) / N; E += L0 * (1 + top * z) * z }
        E *= 2 * Math.PI / N
        ok(`studio: top ${top} puts the set illuminance on a level surface`, Math.abs(E / 2000 - 1) < 1e-6, `${E}`)
    }
    const t = studioLuminance(2000, 0.5, [1, 0.8, 0.6])
    ok('studio: a tint changes the colour, not the luminance', Math.abs(Y(t) - studioLuminance(2000, 0.5)[0]) < 1e-9)
    const d = derive({ envMode: 1, studioIlluminance: 500, studioTop: 0, studioColor: { r: 1, g: 1, b: 1 }, uSunElevation: 45,
                       sunIlluminance: 1e5, skyIlluminance: 1.5e4, neeSunPick: 0.5 })
    ok('studio: no sun, and no light samples spent looking for one', d.sunL === 0 && d.neeSunPick === 0)
    ok('studio: L0 = E / pi when flat', Math.abs(d.studioL[1] - 500 / Math.PI) < 1e-9)
    const s = derive({ envMode: 0, uSunElevation: 45, sunIlluminance: 1e5, neeSunPick: 0.5 })
    ok('sun & sky: the sun pick is the setting, and no studio light', s.neeSunPick === 0.5 && s.studioL.every(v => v === 0))
}

console.log(fail ? `\n${fail} failed, ${pass} passed.` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
