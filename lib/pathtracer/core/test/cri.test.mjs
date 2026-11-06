// node lib/pathtracer/core/test/cri.test.mjs
//
// core/cri.js, the CIE colour rendering index (CIE 13.3; 0.83.0): the CIE's own fluorescent and LED illuminants against
// colour-science's implementation of the same method, a blackbody and daylight reading 100, the reference the method
// picks, DC and its limit, R9, a spectrum by any of its three forms the same index, and what has no index. The CIE's
// tables (data/*.csv) against the module written from them. No GPU.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cri, criOfSampled, daylight } from '../cri.js'
import { CIE_FL, CIE_LED, CIE_TCS, CIE_DAYLIGHT } from '../ciedata.js'
import { spdAt, SPD_PRESETS } from '../spd.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, t) => Math.abs(a - b) <= t

/* COLOUR-SCIENCE'S Ra AND R9 of the CIE's illuminants (colour 0.4.7, colour.colour_rendering_index, run 2026-11-04 in
   this container on the same CSVs). Rounded, its Ra are the figures CIE 015 lists for FL1-FL12 (76, 64, 57, 51, 72, 59,
   90, 95, 90, 81, 83, 83). Ours differ by the CCT's search and the daylight's rounding: within 0.05 in Ra, 0.25 in R9. */
const COLOUR_SCIENCE = {
    'FL1': [75.818, -47.428],
    'FL2': [64.152, -83.911],
    'FL3': [56.682, -102.155],
    'FL4': [51.353, -111.304],
    'FL5': [71.657, -67.731],
    'FL6': [59.014, -104.772],
    'FL7': [90.180, 61.049],
    'FL8': [95.497, 98.471],
    'FL9': [90.289, 69.612],
    'FL10': [80.958, 27.008],
    'FL11': [82.826, 25.246],
    'FL12': [83.051, 0.955],
    'FL3.1': [51.136, -109.973],
    'FL3.2': [70.308, -38.053],
    'FL3.3': [71.771, -63.640],
    'FL3.4': [86.499, 75.368],
    'FL3.5': [96.368, 94.999],
    'FL3.6': [96.288, 93.802],
    'FL3.7': [81.402, -9.250],
    'FL3.8': [80.355, 13.532],
    'FL3.9': [79.573, 23.978],
    'FL3.10': [88.347, 46.398],
    'FL3.11': [77.595, 23.743],
    'FL3.12': [93.024, 56.979],
    'FL3.13': [95.895, 70.625],
    'FL3.14': [94.941, 93.591],
    'FL3.15': [98.465, 96.399],
    'LED-B1': [81.768, 12.576],
    'LED-B2': [82.770, 17.578],
    'LED-B3': [84.829, 23.765],
    'LED-B4': [76.806, -1.625],
    'LED-B5': [80.238, 6.915],
    'LED-BH1': [91.793, 73.452],
    'LED-RGB1': [57.114, -34.214],
    'LED-V1': [95.319, 97.904],
    'LED-V2': [95.659, 95.009],
}

{
    // THE TABLES the index is computed from: the module the CSVs, number for number
    const here = dirname(fileURLToPath(import.meta.url))
    const csv = f => readFileSync(join(here, '..', 'data', f), 'utf8').trim().split(/\r?\n/).map(l => l.split(',').map(Number))
    for (const [file, T] of [['CIE_srf_cri.csv', CIE_TCS], ['CIE_illum_Dxx_comp.csv', CIE_DAYLIGHT], ['CIE_illum_FLs.csv', CIE_FL], ['CIE_illum_LEDs.csv', CIE_LED]]) {
        const rows = csv(file)
        ok(`${file}: the module's every value`, rows.every((r, i) => r[0] === T.lo + 5 * i && T.names.every((n, j) => T.columns[n][i] === r[j + 1])))
    }
    ok('14 test colour samples, 360-830 nm', CIE_TCS.names.length === 14 && CIE_TCS.lo === 360 && CIE_TCS.columns.TCS01.length === 95)
}
{
    // THE CIE'S ILLUMINANTS against colour-science
    let worstRa = 0, worstR9 = 0
    for (const T of [CIE_FL, CIE_LED]) for (const n of T.names) {
        const r = criOfSampled(T.lo, 5, T.columns[n]), [ra, r9] = COLOUR_SCIENCE[n]
        worstRa = Math.max(worstRa, Math.abs(r.Ra - ra)); worstR9 = Math.max(worstR9, Math.abs(r.R[8] - r9))
        ok(`${n}: Ra ${ra.toFixed(1)} and R9 ${r9.toFixed(1)} as colour-science`, near(r.Ra, ra, 0.05) && near(r.R[8], r9, 0.25), `Ra ${r.Ra} R9 ${r.R[8]}`)
    }
    console.log(`(worst against colour-science: Ra ${worstRa.toFixed(3)}, R9 ${worstR9.toFixed(3)})`)
    // the rounded ones CIE 015 lists for FL1-FL12
    const listed = [76, 64, 57, 51, 72, 59, 90, 95, 90, 81, 83, 83]
    ok('FL1-FL12 round to CIE 015\'s 76, 64, 57, 51, 72, 59, 90, 95, 90, 81, 83, 83',
        listed.every((ra, i) => Math.round(criOfSampled(380, 5, CIE_FL.columns[`FL${i + 1}`]).Ra) === ra))
}
{
    // ITS OWN REFERENCE reads 100: a blackbody below 5000 K, the CIE's daylight at and above
    for (const T of [2700, 3000, 4000, 4900]) {
        const r = cri({ kind: 'planck', T })
        ok(`a blackbody at ${T} K: Ra 100, every Ri 100, its reference a blackbody, valid`, near(r.Ra, 100, 0.05) && r.R.every(v => near(v, 100, 0.1))
            && r.reference === 'planck' && r.valid && r.dc < 1e-3, JSON.stringify([r.Ra, r.dc]))
    }
    /* the CIE's daylight: its CCT read back off the locus is a little off its nominal one (D at 5000 K reads 4998 K, and
       so is given a blackbody reference, Ra 98.6: the method doing as it says), so 5100 K and up, within 0.1 */
    for (const T of [5100, 6500, 10000]) {
        const r = cri(daylight(T))
        ok(`the CIE's daylight at ${T} K: Ra 100 within 0.1, its reference daylight`, near(r.Ra, 100, 0.1) && r.reference === 'daylight', JSON.stringify([r.Ra, r.cct]))
    }
    ok('...and at 5000 K it reads 4998 K, below 5000: a blackbody\'s reference, as 13.3 says', cri(daylight(5000)).reference === 'planck')
}
{
    // THE SAME INDEX whatever form the spectrum comes in: a core/spd.js spectrum, a function, samples
    const w = SPD_PRESETS['LED white, about 4000 K (blue die and phosphor)']
    const a = cri(w), b = cri(l => spdAt(w, l))
    const values = []
    for (let l = 380; l <= 780; l += 5) values.push(spdAt(w, l))
    const c = criOfSampled(380, 5, values)
    ok('a spectrum, its function and its 5 nm samples: one Ra', near(a.Ra, b.Ra, 1e-9) && near(a.Ra, c.Ra, 0.2), `${a.Ra} ${b.Ra} ${c.Ra}`)
    ok('...the white LED preset: a plausible white LED, Ra 70-90', a.Ra > 70 && a.Ra < 90, String(a.Ra))
}
{
    // WHAT HAS NO INDEX, and what has one that means little
    ok('no light: none', cri({ kind: 'table', points: [[500, 0], [510, 0]] }) === null)
    const blue = cri(SPD_PRESETS['LED royal blue 450 nm'])
    ok('a royal blue LED: no CCT in range, none', blue === null, JSON.stringify(blue))
    const amber = cri(SPD_PRESETS['LED amber 590 nm'])
    ok('an amber LED: an index, far off the locus and so not valid (DC > 5.4e-3)', amber && !amber.valid && amber.dc > 5.4e-3, JSON.stringify(amber && [amber.Ra, amber.dc]))
}

console.log(`cri: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
