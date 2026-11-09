// node lib/pathtracer/core/data/cie1931.make.mjs
//
// WRITES ../cie1931.js FROM THE CIE'S OWN TABLE, CIE_xyz_1931_2deg.csv beside this file: the CIE 1931 colour-matching
// functions, 2 degree observer, 360-830 nm every 1 nm (CIE 018:2019, Table 6), as the CIE publishes it
// (https://cie.co.at/datatable/cie-1931-colour-matching-functions-2-degree-observer, DOI 10.25039/CIE.DS.xvudnb9b; the
// file's md5 is the page's, 17cca777db64b17170f06f67ce9d3ab7). The renderer needs it exactly: the analytic fit in
// spectral.js is 0.015 off within 450-650 nm and curls back past 644 nm (a 700 nm line came out xy 0.568, 0.432), which
// is fine for averaging a coating per channel and wrong for the colour of a deep red LED (roadmap/LIGHT_MODEL.md S1).
// The table is CC BY-SA 4.0 (the CIE's licence for it), and so is the module this writes, which is the same numbers in
// another syntax: THIRD_PARTY.md says so. Run it only if the CSV changes; spd.test.mjs holds the module to the CSV.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const csv = readFileSync(join(here, 'CIE_xyz_1931_2deg.csv'))
const md5 = createHash('md5').update(csv).digest('hex')
if (md5 !== '17cca777db64b17170f06f67ce9d3ab7') throw new Error(`the CSV is not the CIE's (md5 ${md5})`)
const rows = csv.toString().trim().split(/\r?\n/).map(l => l.split(',').map(Number))
rows.forEach((r, i) => { if (r.length !== 4 || r[0] !== 360 + i || r.some(v => !Number.isFinite(v))) throw new Error(`row ${i + 1}: ${r}`) })
if (rows.length !== 471) throw new Error(`${rows.length} rows, expected 471 (360-830 nm)`)
const col = j => rows.map(r => r[j]).join(',')
writeFileSync(join(here, '..', 'cie1931.js'), `//======================================================================================================================
// THE CIE 1931 COLOUR-MATCHING FUNCTIONS, 2 DEGREE OBSERVER, 360-830 nm every 1 nm -- written by
// data/cie1931.make.mjs from the CIE's own CSV (data/CIE_xyz_1931_2deg.csv, md5 ${md5}). Do not edit: run the script.
//
// Source: CIE 2019, Colour-matching functions of CIE 1931 standard colorimetric observer, International Commission on
// Illumination (CIE), Vienna, AT, DOI: 10.25039/CIE.DS.xvudnb9b (CIE 018:2019, Table 6).
// Licence: Creative Commons Attribution-ShareAlike 4.0 International (https://creativecommons.org/licenses/by-sa/4.0/),
// the CIE's for the table; this file is the same numbers in another syntax, under the same licence (THIRD_PARTY.md).
//======================================================================================================================
/** The first wavelength (nm), the step (nm) and the count: CIE_X[i] is x-bar at CIE_LO + i nm. */
export const CIE_LO = 360, CIE_STEP = 1, CIE_N = ${rows.length}
export const CIE_X = Float64Array.of(${col(1)})
export const CIE_Y = Float64Array.of(${col(2)})
export const CIE_Z = Float64Array.of(${col(3)})
`)
console.log(`wrote cie1931.js: ${rows.length} rows, md5 ${md5}`)
