//======================================================================================================================
// Tests for the environment as code (0.next; lib/pathtracer/core/environment.js, envmap.js, sdf.js THE ENVIRONMENT, and
// the builder's side, builder/sky.js). Run: node builder/test/sky.test.mjs
//
// The presets are the model: the default the renderer compiles is their own functions, and the code box starts from
// their text. The block as a document's: none by default, saved and read, refused when it defines no background or
// reaches into the functions block, a node called sky still a node; version 31's migration of the old sun and sky
// settings. Codegen: nothing about a sky in a scene without one, the scene's kernels' text the same beside one, the block
// at its own lines (SKY_ID). The kernels' text: shade, the photons and the map with the code, shade alone with the map.
// The sun & sky against a JS copy of its text (the numbers the text is made of read back from it): a clear day's lux at
// the default sun, the low sun dimmer and redder. The studio's integral. The map's tables (envSampling) against a JS
// mirror of the WGSL that reads them: a histogram of drawn directions is the density, the density integrates to 1, the
// level's lux of a uniform sky is pi. The Insert pane's recipes calling only what exists. That every kernel compiles is
// check-shaders' (pass four, naga); how it looks is the user's.
//======================================================================================================================
import * as M from '../model.js'
import { generate } from '../codegen.js'
import { resolve } from '../emit.js'
import { CODE_BLOCKS, recipeText, preludeSignatures } from '../coderef.js'
import { sceneTextOf } from '../../lib/pathtracer/core/uniforms.schema.js'
import { ENV_STUB, ENV_MAP_STUB, withEnvironment } from '../../lib/pathtracer/core/sdf.js'
import { ENV_FN, ENV_PRESETS, ENV_DEFAULT, envCodeOf, SKY_BANDS, SKY_BAND_TABLE, SUN_OUTSIDE_TINT, rayleighDepth, angstrom,
         OZONE_SIGMA, OZONE_DU, DOBSON } from '../../lib/pathtracer/core/environment.js'
import { CIE_X, CIE_Y, CIE_Z, CIE_LO, CIE_N } from '../../lib/pathtracer/core/cie1931.js'
import { rgbToXYZ, XYZtoxy, xyToCctDuv } from '../../lib/pathtracer/core/colorimetry.js'
import { ENV_W, ENV_H, ENV_MAP_WGSL, ENV_CONE_THREADS, ENV_CONE_EACH, envSampling, rowZ } from '../../lib/pathtracer/core/envmap.js'
import { SHADE_PRELUDE, SCENE_PRELUDE } from '../../lib/pathtracer/core/scene_api.js'
import { parseHDR, envImageAt, toHalf, envImageTexels, linearFromSRGB, ENV_IMAGE_STUB, ENV_IMAGE_WGSL, ENV_IMAGE_RESOURCE } from '../../lib/pathtracer/core/envimage.js'
import { makeHDR } from '../../lib/pathtracer/darkroom/export/hdr.js'
import { hdrFromBytes, envPictureOf, usedImages, HDR_TYPE } from '../images.js'
import { prog_shade, prog_genphotons, prog_envbake, prog_envcache } from '../../lib/pathtracer/core/wavefront.js'
import { envWithParams, replaceWords, envPresetCompiled, ENV_PARAM_SLOTS } from '../../lib/pathtracer/core/environment.js'
import { ComputeUniformTypes, UniformGroups, UniformSpec } from '../../lib/pathtracer/core/uniforms.schema.js'
import { ENV_CACHE_STUB, ENV_CACHE_RESOURCE, ENV_CACHE_SIZES, cacheUV } from '../../lib/pathtracer/core/envmap.js'
import { viewWhiteMatrix, viewWhite, levelLight, IDENTITY4, WB_DEFAULT } from '../../lib/pathtracer/core/whitebalance.js'
import { XYZtoRGB } from '../../lib/pathtracer/core/colorimetry.js'
import { typedColumn } from '../emit.js'
import { withoutComments } from '../helpers.js'
import { sceneParams } from '../params.js'
import { liveKeyOfPath } from '../animate.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const throws = (name, fn, match) => {
    try { fn() } catch (e) { ok(name, !match || match.test(String(e.message)), `threw: ${e.message}`); return }
    ok(name, false, 'did not throw')
}
const scene = sky => {
    const d = M.createDoc()
    M.addObject(d, 'root', { id: 'ball', primitive: 'sphere' })
    if (sky !== undefined) d.sky = sky
    return d
}
const fnText = (text, name) => { const i = text.indexOf(`fn ${name}(`); return i < 0 ? null : text.slice(i, text.indexOf('\n}', i) + 2) }

//----------------------------------------------------------------------------------------------------------------------
// the presets are the model
//----------------------------------------------------------------------------------------------------------------------
{
    ok('the renderer and the builder name one function', M.SKY_FN === ENV_FN && ENV_FN === 'background')
    ok('four presets: the sun & sky, the studio, the stars, an image, each defining background', ENV_PRESETS.map(p => p.id).join() === 'sunsky,studio,stars,image'
        && ENV_PRESETS.every(p => M.skyProblems(p.text).length === 0))
    ok('...the sun & sky with a sun to aim at, the others without', ENV_PRESETS.map(p => p.sunHint).join() === '1,0,0,0')
    ok('the builder\'s starts are the renderer\'s texts', M.SKY_PRESETS.every((p, i) => p.code === ENV_PRESETS[i].text)
        && M.SKY_TEMPLATE === ENV_PRESETS[0].text && M.STUDIO_TEMPLATE === ENV_PRESETS[1].text)
    ok('the default is the sun & sky\'s and the studio\'s own functions, word for word',
        ['sunSky', 'studioLight'].every(f => fnText(ENV_DEFAULT, f) && fnText(ENV_DEFAULT, f) === fnText(ENV_PRESETS.find(p => fnText(p.text, f)).text, f)))
    ok('...choosing by envMode', /if \(UB\.envMode == 1u\) \{ return studioLight\(dir\); \}/.test(ENV_DEFAULT))
    ok('a scene is lit by its own code, or by the default', envCodeOf({ sky: 'x' }) === 'x' && envCodeOf({}) === ENV_DEFAULT
        && envCodeOf({ sky: '   ' }) === ENV_DEFAULT && envCodeOf(null) === ENV_DEFAULT)
    ok('what the code box shows: the scene\'s own, or the default\'s preset for its envMode',
        M.skyTextOf({ sky: 'own' }) === 'own' && M.skyTextOf({}, 0) === M.SKY_TEMPLATE && M.skyTextOf({}, 1) === M.STUDIO_TEMPLATE)
    const r = M.skyReads(M.SKY_TEMPLATE), st = M.skyReads(M.STUDIO_TEMPLATE), sr = M.skyReads(M.STARS_TEMPLATE)
    ok('the rows a text reads: the sun & sky the sun above the air and the haze, and the sun\'s place',
        r.names.has('sunOutside') && r.names.has('uSkyTurbidity') && r.sun && !r.names.has('studioIlluminance'))
    ok('...the studio its three, no sun; the stars none', ['studioIlluminance', 'studioTop', 'studioColor'].every(k => st.names.has(k)) && !st.sun
        && sr.names.size === 0 && !sr.sun)
    ok('...and a setting named only in a comment is not read', M.skyReads('// UB.sunOutside\nfn background(dir: VEC3) -> VEC3 { return dir; }').names.size === 0)
}

//----------------------------------------------------------------------------------------------------------------------
// the block in the document, and version 31
//----------------------------------------------------------------------------------------------------------------------
{
    ok('a new document has no environment code', !('sky' in M.createDoc()))
    ok('no block, an empty one and comments only are no code', !M.hasSky(undefined) && !M.hasSky('') && !M.hasSky('// a note\n/* another */') && M.hasSky(M.SKY_TEMPLATE))
    ok('a block without background(dir) is refused', /must define fn background/.test(M.skyProblems('fn other(d: VEC3) -> VEC3 { return d; }').join()))
    ok('...and one that is not text', /string/.test(M.skyProblems(42).join()))
    const fns = 'fn glow(d: VEC3) -> VEC3 { return d; }\nconst HALF = 0.5;'
    const calls = 'fn background(dir: VEC3) -> VEC3 { return glow(dir) * HALF; }'
    ok('a name of the functions block the code reads is refused, by name', (p => p.length === 2 && /'glow'/.test(p[0]) && /'HALF'/.test(p[1]))(M.skyProblems(calls, fns)))
    ok('...not one it defines itself', M.skyProblems(`${calls}\nfn glow(d: VEC3) -> VEC3 { return d; }\nconst HALF = 0.5;`, fns).length === 0)
    const d = scene(M.STARS_TEMPLATE)
    ok('the code is saved and read as it was', M.parse(M.serialize(d)).sky === M.STARS_TEMPLATE)
    throws('a file whose code defines no background is refused', () => M.parse(M.serialize(scene('fn x() {}'))), /background/)
    const named = M.createDoc()
    M.addObject(named, 'root', { id: 'sky', primitive: 'sphere' })
    ok('a node called sky is still a node (the block\'s lines are #sky\'s)', M.parse(M.serialize(named)).root.children[0].id === 'sky' && M.SKY_ID === '#sky')
    ok('toTree hands the code to codegen', M.toTree(d).sky === M.STARS_TEMPLATE && M.toTree(scene()).sky === '')

    ok('the model is version 31', M.VERSION === 31)
    const old = { ...JSON.parse(M.serialize(scene())), version: 30,
        environment: { envMode: 0, sunIlluminance: 100000, skyIlluminance: 15000, skyCodeIlluminance: 5000, uSunElevation: 30 } }
    const up = M.parse(JSON.stringify(old))
    ok('a file of 30: the sun at the ground becomes the sun above the air, 1.28 times; the sky\'s setting goes',
        up.version === 31 && up.environment.sunOutside === 128000 && !('sunIlluminance' in up.environment)
        && !('skyIlluminance' in up.environment) && !('skyCodeIlluminance' in up.environment) && up.environment.uSunElevation === 30)
    ok('...and a file of 30 with no environment reads as it was', M.parse(JSON.stringify({ ...old, environment: undefined })).environment === undefined)
    throws('a 31 file\'s environment with a retired setting is refused, by name', () => M.parse(JSON.stringify({ ...old, version: 31 })), /sunIlluminance/)
}

//----------------------------------------------------------------------------------------------------------------------
// codegen's text
//----------------------------------------------------------------------------------------------------------------------
{
    const plain = generate(M.toTree(scene()), { id: 'x' })
    const notes = generate(M.toTree(scene('// only a note')), { id: 'x' })
    const withSky = generate(M.toTree(scene(M.SKY_TEMPLATE)), { id: 'x' })
    ok('a scene without code has no sky, and its text is what it was', !('sky' in plain) && !/THE SKY BLOCK/.test(plain.body))
    ok('...nor does one whose code is comments only', !('sky' in notes) && notes.body === plain.body)
    ok('with code, the scene carries it', withSky.sky === M.SKY_TEMPLATE)
    ok('...and the scene\'s kernels\' text is the one without it', withSky.wgsl === plain.wgsl && !/fn background/.test(withSky.wgsl))
    ok('...while the checked body has it, and calls it as envBackground will', withSky.body.includes(M.SKY_TEMPLATE.trim())
        && /fn skyBlockCalled\(d: VEC3\) -> VEC3 \{ return background\(d\); \}/.test(withSky.body))
    const lines = withSky.body.split('\n')
    const at = lines.findIndex(l => l.startsWith('fn background(')) + 1
    const own = M.SKY_TEMPLATE.split('\n').findIndex(l => l.startsWith('fn background(')) + 1
    const r = resolve(withSky.map, at)
    ok('an error in the code is reported at its own line, as #sky\'s', r?.node === M.SKY_ID && r?.line === own, JSON.stringify(r))
    ok('sceneTextOf tells a scene with code from one without, and one code from another',
        sceneTextOf(plain) !== sceneTextOf(withSky) && sceneTextOf(withSky) !== sceneTextOf(generate(M.toTree(scene(M.STARS_TEMPLATE)), { id: 'x' }))
        && sceneTextOf(plain) === sceneTextOf(notes))
}

//----------------------------------------------------------------------------------------------------------------------
// the kernels' text
//----------------------------------------------------------------------------------------------------------------------
{
    const count = (s, x) => s.split(x).length - 1
    ok('every prelude has the two stubs once', [SHADE_PRELUDE, SCENE_PRELUDE].every(p => count(p, ENV_STUB) === 1 && count(p, ENV_MAP_STUB) === 1))
    const code = 'fn background(dir: VEC3) -> VEC3 { return VEC3(1.0); }   // $& $1 stay as typed'
    const w = withEnvironment(SHADE_PRELUDE, code, { map: ENV_MAP_WGSL })
    ok('with code and the map: the stubs replaced, the code after, as typed', !w.includes(ENV_STUB) && !w.includes(ENV_MAP_STUB)
        && /fn envBackground\(dir: VEC3\) -> VEC3 \{ return background\(dir\); \}/.test(w) && w.includes(code) && w.includes('fn envMapSample('))
    ok('...the map only when asked', withEnvironment(SHADE_PRELUDE, code).includes(ENV_MAP_STUB))
    throws('no code is refused, not left black', () => withEnvironment(SHADE_PRELUDE, ''), /no environment code/)
    throws('a prelude with no stub is refused', () => withEnvironment('fn x() {}', code), /no environment stub/)

    const WG = { makeCompute: async body => body }
    const shadeDefault = await prog_shade(WG, { wgsl: '' }, 64)
    const shadeStars = await prog_shade(WG, { wgsl: '', sky: M.STARS_TEMPLATE }, 64)
    ok('shade without code of the scene\'s: the default, and the map', shadeDefault.includes(ENV_DEFAULT) && shadeDefault.includes('fn envMapSample(') && !shadeDefault.includes(ENV_STUB))
    ok('...with it, the scene\'s', shadeStars.includes(M.STARS_TEMPLATE) && !shadeStars.includes(ENV_DEFAULT))
    const photons = await prog_genphotons(WG, 64, { wgsl: '', sky: M.STARS_TEMPLATE })
    const bake = await prog_envbake(WG, { sky: M.STARS_TEMPLATE })
    ok('the sun\'s photons and the map have the code too, and no map to draw from', [photons, bake].every(t => t.includes(M.STARS_TEMPLATE) && t.includes(ENV_MAP_STUB)))
}

//----------------------------------------------------------------------------------------------------------------------
// THE SUN & SKY against a JS copy of its text. The numbers it is made of are read back from the text, so the copy and
// the text cannot drift apart unnoticed; the copy's structure is the text's, line for line. Its colours against the
// same model integrated at every nanometre with the CIE 1931 functions: what its sixteen bands stand for.
//----------------------------------------------------------------------------------------------------------------------
{
    const text = M.SKY_TEMPLATE
    const arr = name => { const m = new RegExp(`const ${name} = array<[^>]*>\\(([^;]*)\\);`).exec(text); return m ? m[1] : null }
    const tauR = arr('SKY_BAND_TAUR')?.split(',').map(Number), haze = arr('SKY_BAND_HAZE')?.split(',').map(Number)
    const ozone = arr('SKY_BAND_OZONE')?.split(',').map(Number)
    const rgb = [...(arr('SKY_BAND_RGB') ?? '').matchAll(/VEC3\(([^)]*)\)/g)].map(m => m[1].split(',').map(Number))
    ok('the text\'s sixteen bands are the table\'s: Rayleigh depths, haze, ozone, colour', tauR?.length === SKY_BANDS && haze?.length === SKY_BANDS
        && ozone?.length === SKY_BANDS && rgb.length === SKY_BANDS
        && SKY_BAND_TABLE.every((b, k) => Math.abs(b.tauR - tauR[k]) < 1e-6 && Math.abs(b.haze - haze[k]) < 1e-6 && Math.abs(b.ozone - ozone[k]) < 1e-6
                                         && b.rgb.every((x, c) => Math.abs(x - rgb[k][c]) < 1e-6)))
    /* THE OZONE (0.next): 300 Dobson units of it (8.06e18 molecules per cm^2), the Chappuis band's cross-sections at 223 K
       (Serdyuchenko et al. 2014) averaged over each band: their largest about 4.7e-21 cm^2 near 600 nm, so a depth
       straight up of about 0.038 there -- and next to nothing at the violet end, a little at the red */
    const peak = SKY_BAND_TABLE.reduce((a, b) => b.ozone > a.ozone ? b : a)
    ok(`...the ozone's depth peaking at ${peak.nm.toFixed(0)} nm, ${peak.ozone.toFixed(4)} straight up (0.03-0.045 near 600 nm), under 0.001 at 380 nm`,
        peak.nm > 560 && peak.nm < 640 && peak.ozone > 0.03 && peak.ozone < 0.045 && ozone[0] < 0.001 && ozone[SKY_BANDS - 1] < 0.01
        && SKY_BAND_TABLE.every((b, k) => Math.abs(b.ozone - OZONE_SIGMA[k] * OZONE_DU * DOBSON) < 1e-12), JSON.stringify(ozone))
    ok('...the depths Hansen & Travis\'s and Angstrom\'s at the bands\' middles', SKY_BAND_TABLE.every(b => Math.abs(b.tauR - rayleighDepth(b.nm / 1000)) < 1e-12)
        && Math.abs(rayleighDepth(0.55) - 0.0973) < 2e-4 && Math.abs(angstrom(550) - 1) < 1e-12)
    const sum = rgb.reduce((a, b) => a.map((x, c) => x + b[c]), [0, 0, 0])
    const Y = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    ok('...their colours adding up to a 5778 K white of luminance 1', Math.abs(Y(sum) - 1) < 1e-5 && sum.every((x, c) => Math.abs(x - SUN_OUTSIDE_TINT[c]) < 1e-5)
        && Math.abs(xyToCctDuv(...XYZtoxy(rgbToXYZ(sum))).cct - 5778) < 60, JSON.stringify(sum))
    const airMass = c => { c = Math.min(Math.max(c, 0), 1); const z = Math.acos(c) * 180 / Math.PI; return 1 / (c + 0.15 * Math.pow(Math.max(93.885 - z, 0.1), -1.253)) }
    const sunSky = (d, s, E0 = 128000, turb = 0.7) => {
        const aerosol = 0.05 + 0.1 * turb, mv = airMass(d[2]), ms = airMass(s[2]), c = d[0] * s[0] + d[1] * s[1] + d[2] * s[2], g = 0.7
        const pR = 3 / (16 * Math.PI) * (1 + c * c), pM = (1 - g * g) / (4 * Math.PI * Math.pow(1 + g * g - 2 * g * c, 1.5))
        const up = Math.min(1, Math.max(0, (s[2] + 0.05) / 0.05)), dm = mv - ms, L = [0, 0, 0]
        for (let k = 0; k < SKY_BANDS; k++) {
            const tr = tauR[k], ta = aerosol * haze[k], tau = tr + ta + ozone[k]
            const k1 = Math.abs(dm) < 1e-3 ? tau * mv * Math.exp(-tau * mv) : mv * (Math.exp(-tau * ms) - Math.exp(-tau * mv)) / dm
            const v = (tr * pR + 0.9 * ta * pM) / tau * k1 * up
            for (let i = 0; i < 3; i++) L[i] += rgb[k][i] * v
        }
        return L.map(x => Math.max(0, E0 * x))
    }
    const sunAt = (E0, el, turb = 0.7) => { const ms = airMass(Math.sin(el)), L = [0, 0, 0]
        for (let k = 0; k < SKY_BANDS; k++) { const v = Math.exp(-(tauR[k] + (0.05 + 0.1 * turb) * haze[k] + ozone[k]) * ms); for (let i = 0; i < 3; i++) L[i] += rgb[k][i] * v }
        return L.map(x => E0 * x) }
    const skyLux = el => {
        const s = [0, Math.cos(el), Math.sin(el)], N = 200
        let acc = 0
        for (let i = 0; i < N * N; i++) {
            const u = [((i % N) + 0.5) / N, (Math.floor(i / N) + 0.5) / N], r = Math.sqrt(u[0]), p = 2 * Math.PI * u[1]
            acc += Y(sunSky([r * Math.cos(p), r * Math.sin(p), Math.sqrt(1 - u[0])], s))
        }
        return Math.PI * acc / (N * N)
    }
    const r45 = Math.PI / 4, sun45 = Y(sunAt(128000, r45)), sky45 = skyLux(r45)
    if (process.env.SKY_NUMBERS) {
        const cct = v => Math.round(xyToCctDuv(...XYZtoxy(rgbToXYZ(v))).cct)
        for (const el of [45, 15, 5]) { const e = el * Math.PI / 180, s = [0, Math.cos(e), Math.sin(e)]
            console.log(`${el} deg: sun ${Math.round(Y(sunAt(128000, e)))} lx ${cct(sunAt(1, e))} K, sky ${Math.round(skyLux(e))} lx, zenith ${cct(sunSky([0, 0, 1], s))} K`) }
    }
    ok(`at the default sun, a clear day: the sun ${Math.round(sun45)} lx head-on (80-110 klx), the sky ${Math.round(sky45)} lx on the level (10-20 klx)`,
        sun45 > 80000 && sun45 < 110000 && sky45 > 10000 && sky45 < 20000)
    const low = sunAt(128000, 5 * Math.PI / 180), high = sunAt(128000, r45)
    ok('a low sun is dimmer and redder: 5 degrees up, a fifth of the light and blue below red by more',
        Y(low) < Y(high) / 4 && low[2] / low[0] < 0.5 * high[2] / high[0])
    ok('the sun set by more than 3 degrees: no sky', Y(sunSky([0, 0, 1], [0, Math.cos(-0.06), Math.sin(-0.06)])) === 0)
    /* the same model at every nanometre (the CIE's table, 1 nm), the sunlight Planck's at 5778 K: the bands' colours. Its
       ozone the bands' own cross-sections drawn through linearly (the 1 nm table is not kept here): what this holds is
       the bands' sum against the integral, not the ozone's data */
    const bandNm = SKY_BAND_TABLE.map(b => b.nm)
    const sigmaAt = l => {
        if (l <= bandNm[0]) return OZONE_SIGMA[0]
        for (let k = 1; k < SKY_BANDS; k++) if (l <= bandNm[k]) { const t = (l - bandNm[k - 1]) / (bandNm[k] - bandNm[k - 1]); return OZONE_SIGMA[k - 1] + t * (OZONE_SIGMA[k] - OZONE_SIGMA[k - 1]) }
        return OZONE_SIGMA[SKY_BANDS - 1]
    }
    const C2 = 1.438776877e-2, B = l => { const m = l * 1e-9; return 1 / (m ** 5 * (Math.exp(C2 / (m * 5778)) - 1)) }
    const spectral = (d, s, sunOnly) => {
        const aerosol = 0.12, mv = airMass(d[2]), ms = airMass(s[2]), c = d[0] * s[0] + d[1] * s[1] + d[2] * s[2], g = 0.7
        const pR = 3 / (16 * Math.PI) * (1 + c * c), pM = (1 - g * g) / (4 * Math.PI * Math.pow(1 + g * g - 2 * g * c, 1.5)), dm = mv - ms, X = [0, 0, 0]
        for (let i = 0; i < CIE_N; i++) {
            const l = CIE_LO + i, tr = rayleighDepth(l / 1000), ta = aerosol * angstrom(l), tau = tr + ta + sigmaAt(l) * OZONE_DU * DOBSON
            const v = sunOnly ? Math.exp(-tau * ms) : (tr * pR + 0.9 * ta * pM) / tau * (Math.abs(dm) < 1e-3 ? tau * mv * Math.exp(-tau * mv) : mv * (Math.exp(-tau * ms) - Math.exp(-tau * mv)) / dm)
            X[0] += B(l) * v * CIE_X[i]; X[1] += B(l) * v * CIE_Y[i]; X[2] += B(l) * v * CIE_Z[i]
        }
        return X
    }
    const cctOf = xyz => xyToCctDuv(...XYZtoxy(xyz)).cct
    for (const el of [45, 15]) {
        const e = el * Math.PI / 180, s = [0, Math.cos(e), Math.sin(e)]
        const zb = cctOf(rgbToXYZ(sunSky([0, 0, 1], s))), zs = cctOf(spectral([0, 0, 1], s, false))
        const sb = cctOf(rgbToXYZ(sunAt(1, e))), ss = cctOf(spectral(s, s, true))
        ok(`the sun ${el} degrees up: the zenith ${Math.round(zb)} K and the sun ${Math.round(sb)} K, the spectrum's ${Math.round(zs)} and ${Math.round(ss)}, within 60 K`,
            Math.abs(zb - zs) < 60 && Math.abs(sb - ss) < 60)
    }
    ok('...the zenith blue and the sun warm', cctOf(rgbToXYZ(sunSky([0, 0, 1], [0, Math.cos(r45), Math.sin(r45)]))) > 8000 && cctOf(rgbToXYZ(high)) < 5500)
    // THE STUDIO: L0 (1 + top z) puts the setting on the level, whatever top is
    for (const top of [0, 0.5, 1]) {
        const L0 = 2000 / (Math.PI * (1 + 2 * top / 3)), N = 100000
        let E = 0
        for (let i = 0; i < N; i++) { const z = (i + 0.5) / N; E += L0 * (1 + top * z) * z }
        ok(`the studio's code at top ${top}: the setting on the level`, Math.abs(E * 2 * Math.PI / N / 2000 - 1) < 1e-6)
    }
    ok('...and it is that code', /let L0 = max\(UB\.studioIlluminance, 0\.0\) \/ \(PI \* \(1\.0 \+ 2\.0 \* top \/ 3\.0\)\);/.test(M.STUDIO_TEMPLATE))
}

//----------------------------------------------------------------------------------------------------------------------
// THE MAP'S TABLES (envSampling), read by a JS mirror of the WGSL that reads them (envmap.js ENV_MAP_WGSL)
//----------------------------------------------------------------------------------------------------------------------
{
    const N = ENV_W * ENV_H
    /* FOUR FLOATS A TEXEL AND A CONE THREAD (envmap.js ENV_BAKE_MAIN, 0.next): its luminance, then its R, G and B -- the
       colours for the view's white balance (core/whitebalance.js levelLight). Here grey: each channel the luminance. */
    const out = new Float32Array(4 * (N + ENV_CONE_THREADS))
    const put = (i, y, rgb = [y, y, y]) => { out[4 * i] = y; out.set(rgb, 4 * i + 1) }
    // a dim uniform sky, one bright texel, and a bright band near the horizon
    for (let i = 0; i < N; i++) put(i, 1)
    const hot = 77 * ENV_W + 300
    put(hot, 50000)
    for (let x = 0; x < ENV_W; x++) put(120 * ENV_W + x, 200)
    for (let t = 0; t < ENV_CONE_THREADS; t++) put(N + t, 2 * ENV_CONE_EACH, [2 * ENV_CONE_EACH, 0, 0])   // Y cos of 2, all red
    const S = envSampling(out, 1e-4)
    const T = S.tex, at = (x, y, c) => T[4 * (y * ENV_W + x) + c]
    // the mirror of envMapSample / envMapPdf
    const sample = u => {
        let lo = 0, hi = ENV_H - 1
        while (lo < hi) { const mid = (lo + hi) >> 1; if (u[0] < at(0, mid, 2)) hi = mid; else lo = mid + 1 }
        const row = lo, r0 = row > 0 ? at(0, row - 1, 2) : 0, r1 = at(0, row, 2)
        const fy = Math.min(Math.max((u[0] - r0) / Math.max(r1 - r0, 1e-12), 0), 0.999999)
        lo = 0; hi = ENV_W - 1
        while (lo < hi) { const mid = (lo + hi) >> 1; if (u[1] < at(mid, row, 0)) hi = mid; else lo = mid + 1 }
        const col = lo, c0 = col > 0 ? at(col - 1, row, 0) : 0, c1 = at(col, row, 0)
        const fx = Math.min(Math.max((u[1] - c0) / Math.max(c1 - c0, 1e-12), 0), 0.999999)
        const z = 1 - 2 * (row + fy) / ENV_H, phi = 2 * Math.PI * (col + fx) / ENV_W, s = Math.sqrt(Math.max(0, 1 - z * z))
        return [s * Math.cos(phi), s * Math.sin(phi), z]
    }
    const texelOf = d => {
        const a = Math.atan2(d[1], d[0]) / (2 * Math.PI), f = a - Math.floor(a)
        return [Math.min(Math.max(Math.floor(f * ENV_W), 0), ENV_W - 1), Math.min(Math.max(Math.floor((1 - d[2]) * 0.5 * ENV_H), 0), ENV_H - 1)]
    }
    const pdf = d => { const [x, y] = texelOf(d); return at(x, y, 1) }
    ok('the CDFs end at 1: every row\'s, and down the rows', [...Array(ENV_H).keys()].every(y => at(ENV_W - 1, y, 0) === 1) && at(0, ENV_H - 1, 2) === 1)
    let total = 0
    for (let i = 0; i < N; i++) total += T[4 * i + 1] * 4 * Math.PI / N
    ok('the density integrates to 1 over the sphere', Math.abs(total - 1) < 1e-6, total)
    ok('every texel can be drawn: the floor', [...Array(N).keys()].every(i => T[4 * i + 1] > 0))
    // drawn directions land in proportion to the density: the bright texel's share, and the band's
    let inHot = 0, inBand = 0
    const K = 200000
    let seed = 12345
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    let mismatch = 0
    for (let k = 0; k < K; k++) {
        const d = sample([rnd(), rnd()])
        const [x, y] = texelOf(d)
        if (y * ENV_W + x === hot) inHot++
        if (y === 120) inBand++
        if (k < 2000 && Math.abs(Math.hypot(...d) - 1) > 1e-9) mismatch++
    }
    const P = i => T[4 * i + 1] * 4 * Math.PI / N
    const pBand = [...Array(ENV_W).keys()].reduce((a, x) => a + P(120 * ENV_W + x), 0)
    ok(`the bright texel drawn ${(inHot / K).toFixed(4)} of the time, its probability ${P(hot).toFixed(4)}`, Math.abs(inHot / K - P(hot)) < 4 * Math.sqrt(P(hot) / K))
    ok(`the band ${(inBand / K).toFixed(4)}, its probability ${pBand.toFixed(4)}`, Math.abs(inBand / K - pBand) < 4 * Math.sqrt(pBand / K))
    ok('...every drawn direction a unit vector, and the density read back where it was drawn the texel\'s', mismatch === 0
        && pdf(sample([0.3, 0.7])) > 0)
    // the level's lux: of the uniform part pi; the cone's head-on lux its solid angle times its mean
    const flatOut = new Float32Array(4 * (N + ENV_CONE_THREADS))
    for (let i = 0; i < N; i++) flatOut.set([1, 1, 0.5, 0.25], 4 * i)
    const flat = envSampling(flatOut, 0)
    ok(`a uniform sky of 1 cd/m^2 puts pi on the level (${flat.skyHorizontal.toFixed(6)})`, Math.abs(flat.skyHorizontal / Math.PI - 1) < 1e-4)
    ok('...and its colour, channel by channel', [1, 0.5, 0.25].every((c, i) => Math.abs(flat.skyRGB[i] / (Math.PI * c) - 1) < 1e-4), flat.skyRGB)
    ok('the cone: its solid angle times its mean', Math.abs(S.sunNormal - 1e-4 * 2) < 1e-12, S.sunNormal)
    ok('...its colour the same way', Math.abs(S.sunRGB[0] - 1e-4 * 2) < 1e-12 && S.sunRGB[1] === 0 && S.sunRGB[2] === 0, S.sunRGB)
    ok('a black environment: no light, a uniform map', (b => b.skyHorizontal === 0 && Math.abs(b.tex[1] * 4 * Math.PI - 1) < 1e-6)(envSampling(new Float32Array(4 * (N + ENV_CONE_THREADS)), 0)))
    ok('rows run from straight up to straight down', rowZ(0) > 0.99 && rowZ(ENV_H - 1) < -0.99)
}

//----------------------------------------------------------------------------------------------------------------------
// AN IMAGE OF THE SURROUNDINGS (core/envimage.js): read, faced, kept and compiled
//----------------------------------------------------------------------------------------------------------------------
{
    // a Radiance file written by the darkroom's writer, read back by the reader: run-length rows (16 wide) and flat (4)
    for (const [w, h] of [[16, 8], [4, 2]]) {
        const rgb = new Float32Array(w * h * 3).map((_, i) => ((i * 37) % 101) / 7 + 0.01)
        const out = makeHDR({ w, h, lines: ['EXPOSURE=1.0'] })
        out.addRows(rgb, h)
        const back = parseHDR(new Uint8Array(await out.finish().arrayBuffer()))
        // RGBE shares one exponent a pixel: each channel is good to 1 % of the pixel's largest
        const worst = rgb.reduce((m, v, k) => { const p = k - k % 3; return Math.max(m, Math.abs(back.rgb[k] - v) / Math.max(rgb[p], rgb[p + 1], rgb[p + 2])) }, 0)
        ok(`a .hdr ${w} x ${h} read back within RGBE's 1 % of each pixel's largest (worst ${(worst * 100).toFixed(2)} %)`, back.width === w && back.height === h && worst < 0.01)
    }
    {
        const out = makeHDR({ w: 8, h: 1, lines: ['EXPOSURE=2'] })
        out.addRows(new Float32Array(24).fill(1), 1)
        ok('...its EXPOSURE taken out: what the file says, divided by it', Math.abs(parseHDR(new Uint8Array(await out.finish().arrayBuffer())).rgb[0] - 0.5) < 0.01)
    }
    throws('what is not a .hdr is refused, saying why', () => parseHDR(new TextEncoder().encode('P6 1 1 255\n')), /Radiance/)
    throws('...and one cut short', () => parseHDR(new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 4 +X 4\n')), /ends/)
    // which way it faces: a picture whose every column says its own number, and whose top half is bright
    const W = 64, H = 32
    const pic = { width: W, height: H, rgb: new Float32Array(W * H * 3) }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 3; pic.rgb[o] = x; pic.rgb[o + 1] = y < H / 2 ? 1 : 0; pic.rgb[o + 2] = 0 }
    const at = (d, t = 0) => envImageAt(pic, d, t)
    ok('its middle column faces +x', Math.abs(at([1, 0, 0])[0] - (W / 2 - 0.5)) < 0.6, at([1, 0, 0])[0])
    ok('...turning right (clockwise from above) runs right across it', at([1, -0.1, 0])[0] > at([1, 0, 0])[0] && at([1, 0.1, 0])[0] < at([1, 0, 0])[0])
    ok('...its top row straight up, its bottom straight down', at([0, 0, 1])[1] === 1 && at([0, 0, -1])[1] === 0)
    ok('...a turn of 90 degrees puts its middle at +y', Math.abs(at([0, 1, 0], 90)[0] - (W / 2 - 0.5)) < 0.6, at([0, 1, 0], 90)[0])
    ok('the WGSL is the same lookup: the same angles, wraps and clamps', /fract\(0\.5 - atan2\(d\.y, d\.x\) \/ \(2\.0 \* PI\) \+ UB\.envImageTurn \/ 360\.0\)/.test(ENV_IMAGE_WGSL)
        && /acos\(clamp\(d\.z, -1\.0, 1\.0\)\) \/ PI/.test(ENV_IMAGE_WGSL) && /\(\(i32\(x0\) % w\) \+ w\) % w/.test(ENV_IMAGE_WGSL))
    // half floats, and the texture's size
    ok('half floats: 1, 65504, a half, 0, and one too small', [toHalf(1), toHalf(65504), toHalf(0.5), toHalf(0), toHalf(1e-9)].join() === [0x3c00, 0x7bff, 0x3800, 0, 0].join())
    ok('...a subnormal and past the largest', toHalf(2 ** -24) === 1 && toHalf(1e6) === 0x7c00)
    const big = envImageTexels({ width: 10000, height: 5000, rgb: new Float32Array(10000 * 5000 * 3).fill(2) }, 4096)
    ok('a picture wider than 4096 box-filtered down by a whole factor, its value kept', big.width === 3333 && big.height === 1666 && big.data[0] === toHalf(2) && big.data[3] === toHalf(1))
    ok('an sRGB byte as light: 255 is 1, 128 about 0.216', (l => l.rgb[0] === 1 && Math.abs(l.rgb[1] - 0.2158) < 1e-3)(linearFromSRGB({ width: 1, height: 1, pixels: new Uint8Array([255, 128, 0, 255]) })))
    // in the document: kept by its key, saved with the scene, compiled in
    const out = makeHDR({ w: 8, h: 4 })
    out.addRows(new Float32Array(8 * 4 * 3).fill(0.25), 4)
    const got = await hdrFromBytes(new Uint8Array(await out.finish().arrayBuffer()), 'sky.hdr')
    ok('a .hdr is a picture of the scene\'s, typed as Radiance', got.entry.type === HDR_TYPE && got.entry.width === 8 && got.scaled === null)
    const d = scene()
    d.sky = ENV_PRESETS.find(p => p.id === 'image').text
    M.addImage(d, got)
    M.setEnvImage(d, got.key)
    ok('its key is the environment\'s, and a file keeps it', d.envImage === got.key && usedImages(d).includes(got.key)
        && JSON.parse(M.serialize(d)).images[got.key] && M.parse(M.serialize(d)).envImage === got.key)
    throws('...a key that is not one is refused', () => M.setEnvImage(d, 'nope'), /key/)
    const g = generate(M.toTree(d), { id: 'x' })
    ok('the scene says it has one, by its key, and can load it', g.envImage?.key === got.key && typeof g.envImage.load === 'function'
        && !Object.keys(g.envImage).includes('load'))
    const pix = await g.envImage.load()
    ok('...its light the file\'s own', pix.width === 8 && Math.abs(pix.rgb[0] - 0.25) < 0.005 && (await envPictureOf(got.entry)).height === 4)
    const noImg = generate(M.toTree(scene()), { id: 'x' })
    ok('sceneTextOf tells a scene with an image from one without, and one image from another', sceneTextOf(g) !== sceneTextOf({ ...g, envImage: undefined })
        && sceneTextOf(g) !== sceneTextOf({ ...g, envImage: { key: 'i' + '0'.repeat(24) } }) && !('envImage' in noImg))
    const WG = { makeCompute: async (body, main, u, res) => ({ body, res }) }
    const sh = await prog_shade(WG, g, 64), shNo = await prog_shade(WG, noImg, 64)
    const ph = await prog_genphotons(WG, 64, g), bk = await prog_envbake(WG, g)
    ok('shade, the photons and the map look it up and bind it, with one', [sh, ph, bk].every(k => k.body.includes('fn envImage(dir: VEC3) -> VEC3 {\n') && !k.body.includes(ENV_IMAGE_STUB) && ENV_IMAGE_RESOURCE in k.res))
    ok('...and without, the stub, black, and no binding', shNo.body.includes(ENV_IMAGE_STUB) && !(ENV_IMAGE_RESOURCE in shNo.res))
    ok('the panel shows the image\'s rows for code that reads it', (r => r.image && r.names.has('envImageLuminance') && r.names.has('envImageTurn'))(M.skyReads(d.sky)))
}

//----------------------------------------------------------------------------------------------------------------------
// THE CODE'S OWN PARAMETERS (0.next; core/environment.js envWithParams, model.js skyParams): names in their slots, the
// lines and the columns typed kept, refused where they would break, live values in sixteen slots
//----------------------------------------------------------------------------------------------------------------------
{
    const stars = M.SKY_PRESETS.find(p => p.id === 'stars')
    ok('the stars start with their parameters', stars.params.map(q => q.name).join() === 'starDepth,starZoom,starShift,starLuminance,starPeak')
    const sub = envWithParams(stars.code, stars.params)
    const words = t => withoutComments(t)
    ok('...each name in its slot, three numbers .xyz, none left in the code', stars.params.every((q, i) =>
        sub.text.includes(`UB.envP${i}.${Array.isArray(q.value) ? 'xyz' : 'x'}`) && !new RegExp(`\\b${q.name}\\b`).test(words(sub.text))))
    ok('...every line where it was, the comments as typed', sub.text.split('\n').length === stars.code.split('\n').length
        && /starZoom how far into it/.test(sub.text))
    const R = replaceWords('let a = b.zoom + zoom(1) + zoom; // zoom\n/* zoom */ x = zoom * 2;', new Map([['zoom', 'UB.envP0.x']]))
    ok('a member, a call and a comment left alone', R.text === 'let a = b.zoom + zoom(1) + UB.envP0.x; // zoom\n/* zoom */ x = UB.envP0.x * 2;', R.text)
    // a column after a slot is the one typed: the ';' of the first line
    const typed = 'let a = b.zoom + zoom(1) + zoom; // zoom'
    ok('...and a column after it taken back to the one typed', typedColumn(R.text.split('\n')[0].indexOf(';') + 1, R.shifts[0]) === typed.indexOf(';') + 1)
    // the model
    const d = scene(stars.code)
    M.setSkyParams(d, stars.params)
    ok('set, they are the scene\'s, and the file sound', M.skyParamsOf(d).length === 5 && M.validate(d).length === 0)
    const back = M.parse(M.serialize(d))
    ok('...saved and read back', JSON.stringify(M.skyParamsOf(back)) === JSON.stringify(stars.params))
    for (const [why, list, re] of [
        ['a name that is no word', [{ name: '2x', value: 1 }], /name must be/],
        ['twice', [{ name: 'a', value: 1 }, { name: 'a', value: 2 }], /twice/],
        ['a word the code needs', [{ name: 'dir', value: 1 }], /a word the code needs/],
        ['a value of two numbers', [{ name: 'a', value: [1, 2] }], /a number or three/],
        ['min above max', [{ name: 'a', value: 1, min: 2, max: 1 }], /min above max/],
        ['seventeen', Array.from({ length: 17 }, (_, i) => ({ name: `p${i}`, value: i })), /at most 16/],
        ['a name the code declares itself', [{ name: 'kaliStars', value: 1 }], /declares it too/],
    ]) {
        const was = JSON.stringify(M.skyParamsOf(d))
        throws(`refused: ${why}`, () => M.setSkyParams(d, list), re)
        ok(`...and nothing changed`, JSON.stringify(M.skyParamsOf(d)) === was)
    }
    M.setSkyParam(d, 'starZoom', 3)
    ok('one value set by name', M.skyParamsOf(d)[1].value === 3)
    throws('...a name it has not refused', () => M.setSkyParam(d, 'nope', 1), /no environment parameter/)
    const U = M.skyParamUniforms(d)
    ok('the slots: all sixteen, the values in their first one or three, 0 in the rest', Object.keys(U).length === ENV_PARAM_SLOTS
        && U.envP1.join() === '3,0,0,0' && U.envP2.join() === '0,0,0,0' && U.envP4.join() === '20,0,0,0' && U.envP15.join() === '0,0,0,0')
    ok('...each a uniform every compute kernel declares', Object.keys(U).every(k => ComputeUniformTypes[k] === 'vec4<f32>'))
    // codegen: the kernels given the code in its slots, an error after a slot at its own line and column
    const g = generate(M.toTree(d), { id: 'x' })
    ok('codegen hands the kernels the code with its slots', g.sky === envWithParams(stars.code, M.skyParamsOf(d)).text && /UB\.envP3\.x/.test(g.sky))
    const line = stars.code.split('\n').findIndex(l => l.includes('VEC3(starPeak)')) + 1
    const lines = g.body.split('\n')
    const gen = lines.findIndex(l => l.includes('VEC3(UB.envP4.x)')) + 1
    const r = resolve(g.map, gen)
    const typedLine = stars.code.split('\n')[line - 1], emitted = lines[gen - 1]
    ok('an error there is #sky\'s, at its line and the column typed', r?.node === M.SKY_ID && r?.line === line
        && typedColumn(emitted.indexOf(';') + 1, r.shifts) === typedLine.indexOf(';') + 1, JSON.stringify(r))
    const renamed = generate(M.toTree(Object.assign(scene(stars.code), { skyParams: stars.params.map(q => q.name === 'starZoom' ? { ...q, value: 9 } : q) })), { id: 'x' })
    ok('a value moved is no compile: the text the same', sceneTextOf(renamed) === sceneTextOf(g))
    // the registry: a row each, live under the environment's id
    const entries = sceneParams(d)
    const e = entries.find(x => x.path === 'scene/environment/param/starShift')
    ok('the registry has a row each, three numbers three', !!e && e.dims === 3 && entries.some(x => x.path === 'scene/environment/param/starZoom'))
    const pushed = []
    const live = sceneParams(d, { live: (id, k) => pushed.push([id, k]) }).find(x => x.path === 'scene/environment/param/starZoom')
    live.set(4)
    ok('...set through it, the value the model\'s and pushed live as the environment\'s', M.skyParamsOf(d)[1].value === 4
        && pushed.length === 1 && pushed[0][0] === M.ENVIRONMENT_ID && pushed[0][1] === 'param/starZoom')
    ok('...and its path the environment\'s for a live push', JSON.stringify(liveKeyOfPath('scene/environment/param/starZoom')) === JSON.stringify({ id: M.ENVIRONMENT_ID, k: 'param/starZoom' }))
    M.setAnimated(d, 'scene/environment/param/starZoom', true)
    ok('...and flagged for the timeline', M.isAnimated(d, 'scene/environment/param/starZoom'))
    // the kernels: the code in its slots compiled into shade, and the renderer's own copy of a preset the same
    const WG = { makeCompute: async body => body }
    const sh = await prog_shade(WG, g, 64)
    ok('shade holds the code in its slots', sh.includes(g.sky))
    ok('a preset compiled without the builder: the same text and the preset\'s values', envPresetCompiled('stars').code === envWithParams(stars.code, stars.params).text
        && envPresetCompiled('stars').uniforms.envP0[0] === 17)
}

//----------------------------------------------------------------------------------------------------------------------
// THE ENVIRONMENT IN A TEXTURE (0.next; core/envmap.js ENV_CACHE_*): the kernel, and envBase reading it outside the cone
//----------------------------------------------------------------------------------------------------------------------
{
    const WG = { makeCompute: async (body, main, u, res, wg) => ({ body, res }) }
    const g = generate(M.toTree(scene(M.STARS_TEMPLATE)), { id: 'x' })
    const c = await prog_envcache(WG, g), sh = await prog_shade(WG, g, 64)
    ok('the texture\'s kernel runs the code and writes the texture', c.body.includes(M.STARS_TEMPLATE) && 'envCacheOut' in c.res)
    ok('...shade reads it, binding it', sh.body.includes('fn envCacheAt(dir: VEC3) -> VEC3') && !sh.body.includes(ENV_CACHE_STUB) && ENV_CACHE_RESOURCE in sh.res)
    ok('...outside the sun\'s cone only, the code inside', /if \(envCacheOn\(\) && !inSunCone\(dir\)\)/.test(sh.body))
    ok('...and the photons, which start in the cone, the code itself', !(ENV_CACHE_RESOURCE in (await prog_genphotons(WG, 64, g)).res))
    ok('the widths offered the setting\'s', ENV_CACHE_SIZES.join() === Object.values(UniformSpec.envCacheSize.gui.options).join())
    // cacheUV's texel centres (rows of equal angle from straight up) land back in their texel
    const w = 64, h = 32
    let bad = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const az = (x + 0.5) / w * 2 * Math.PI, z = Math.cos((y + 0.5) / h * Math.PI), s = Math.sqrt(1 - z * z)
        const [u, v] = cacheUV([s * Math.cos(az), s * Math.sin(az), z])
        if (Math.floor(u * w) !== x || Math.floor(v * h) !== y) bad++
    }
    ok('a direction\'s place in the texture: each texel\'s middle in that texel', bad === 0, `${bad} off`)
}

//----------------------------------------------------------------------------------------------------------------------
// THE VIEW'S WHITE BALANCE (0.next; core/whitebalance.js): the identity at D65, a warm light made white, auto from the
// environment's measure
//----------------------------------------------------------------------------------------------------------------------
{
    const I = viewWhiteMatrix({ whiteK: 6506, whiteTint: 0 })
    ok('6506 K and tint 0: the identity, exactly', I.every((x, i) => x === IDENTITY4[i]))
    const mul = (m, c) => [0, 1, 2].map(r => m[r] * c[0] + m[4 + r] * c[1] + m[8 + r] * c[2])
    // a 3000 K white as linear Rec.709 (Planck's xy, Y 1): balanced to 3000 K it comes out neutral
    const C2 = 1.438776877e-2, B = (l, T) => { const m = l * 1e-9; return 1 / (m ** 5 * (Math.exp(C2 / (m * T)) - 1)) }
    const white = T => { const X = [0, 0, 0]; for (let i = 0; i < CIE_N; i++) { const b = B(CIE_LO + i, T); X[0] += b * CIE_X[i]; X[1] += b * CIE_Y[i]; X[2] += b * CIE_Z[i] } return XYZtoRGB(X.map(x => x / X[1])) }
    const warm = white(3000)
    // tint 0 is D65's Duv (grade.js WB_DEFAULT, the Darkroom's convention): Planck's own locus is that much below it
    const onLocus = -WB_DEFAULT.duv * 1000
    const out = mul(viewWhiteMatrix({ whiteK: 3000, whiteTint: onLocus }), warm)
    ok(`a 3000 K blackbody balanced at 3000 K on the locus comes out neutral (${out.map(x => x.toFixed(3)).join(', ')})`,
        Math.max(...out) / Math.min(...out) < 1.01, JSON.stringify(out))
    // auto: the level's light from the environment's measure
    const env = { skyRGB: [1000, 1000, 1000], sunRGB: warm.map(x => 50000 * x) }
    const auto = viewWhite({ whiteAuto: 1, uSunElevation: 30, whiteK: 6506 }, env, true)
    const lvl = levelLight({ uSunElevation: 30 }, env, true)
    ok(`auto takes the level's light, the sun's at its elevation: ${auto.temp.toFixed(0)} K (from ${auto.from})`, auto.from === 'environment'
        && Math.abs(lvl[0] - (1000 + 50000 * warm[0] * 0.5)) < 1e-6 && auto.temp > 3000 && auto.temp < 3600)
    ok('...without the sun\'s cone, the sky\'s alone', viewWhite({ whiteAuto: 1, uSunElevation: 30 }, env, false).temp > 6000)
    ok('...nothing measured: the setting', viewWhite({ whiteAuto: 1, whiteK: 5000 }, null).temp === 5000)
    ok('...a black environment: the setting', viewWhite({ whiteAuto: 1, whiteK: 5000 }, { skyRGB: [0, 0, 0], sunRGB: [0, 0, 0] }, true).from === 'setting')
    ok('the settings are Exposure\'s', ['whiteK', 'whiteTint', 'whiteAuto'].every(k => k in UniformGroups.Exposure) && UniformSpec.whiteK.def === 6506)
}

//----------------------------------------------------------------------------------------------------------------------
// the Insert pane's recipes: lines of background's body, each a return, calling only the prelude's functions or WGSL's
//----------------------------------------------------------------------------------------------------------------------
{
    const S = preludeSignatures()
    const B = CODE_BLOCKS.sky
    ok('the environment has an Insert pane of its own', !!B && B.recipes.length > 0 && B.fns.includes('Noise'))
    ok('...each recipe a whole answer', B.recipes.every(r => /\breturn\b/.test(recipeText(r))))
    const fns = [...B.recipes.map(recipeText).join('\n').matchAll(/\b([a-z]\w*)\s*\(/g)].map(m => m[1])
    const wgsl = new Set(['mix', 'smoothstep', 'select', 'pow', 'max', 'dot', 'normalize'])
    ok('...calling only the prelude\'s functions or WGSL\'s', fns.every(f => S.has(f) || wgsl.has(f)), fns.filter(f => !S.has(f) && !wgsl.has(f)).join(', '))
    ok('...and sunDirection, inSunDisc and airMass are the prelude\'s', ['sunDirection', 'inSunDisc', 'airMass'].every(f => S.has(f)))
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
