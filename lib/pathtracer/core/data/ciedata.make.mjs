// node lib/pathtracer/core/data/ciedata.make.mjs
//
// WRITES ../ciedata.js FROM FOUR OF THE CIE'S OWN TABLES beside this file (0.next; roadmap/LIGHT_MODEL.md S2), each
// checked against the md5 its datatable page gives:
//   CIE_srf_cri.csv          the 14 test colour samples' spectral radiance factors, 360-830 nm at 5 nm (CIE 13.3; DOI
//                            10.25039/CIE.DS.wuiuu9cz) -- what the colour rendering index is computed on (core/cri.js)
//   CIE_illum_Dxx_comp.csv   the components S0, S1, S2 of daylight, 300-830 nm at 5 nm (CIE 015:2018) -- the reference
//                            illuminant of a source at 5000 K and above
//   CIE_illum_FLs.csv        the fluorescent illuminants FL1-FL12 and FL3.1-FL3.15, 380-780 nm at 5 nm (CIE 015:2018;
//                            DOI 10.25039/CIE.DS.ukaymjdn) -- spectra with known indices, cri.test.mjs's
//   CIE_illum_LEDs.csv       the LED illuminants LED-B1..B5, BH1, RGB1, V1, V2, 380-780 nm at 5 nm (CIE 015:2018;
//                            DOI 10.25039/CIE.DS.vgssnyfg) -- real LED spectra, the presets' and the tests'
// Their licence is the CIE's, CC BY-SA 4.0, and so is the module this writes, which is the same numbers in another
// syntax (THIRD_PARTY.md). Run it only if a CSV changes.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const TABLES = [
    ['CIE_srf_cri.csv', '6ad6522831a844edb8484e884d05c9e9', 'TCS', 360, 830, ['TCS01', 'TCS02', 'TCS03', 'TCS04', 'TCS05', 'TCS06', 'TCS07', 'TCS08', 'TCS09', 'TCS10', 'TCS11', 'TCS12', 'TCS13', 'TCS14']],
    ['CIE_illum_Dxx_comp.csv', '3068737bc5e8561bd8b3ef9639578d18', 'DAYLIGHT', 300, 830, ['S0', 'S1', 'S2']],
    ['CIE_illum_FLs.csv', '441613e501ab0a58e62f2669ff005db7', 'FL', 380, 780, ['FL1', 'FL2', 'FL3', 'FL4', 'FL5', 'FL6', 'FL7', 'FL8', 'FL9', 'FL10', 'FL11', 'FL12',
        'FL3.1', 'FL3.2', 'FL3.3', 'FL3.4', 'FL3.5', 'FL3.6', 'FL3.7', 'FL3.8', 'FL3.9', 'FL3.10', 'FL3.11', 'FL3.12', 'FL3.13', 'FL3.14', 'FL3.15']],
    ['CIE_illum_LEDs.csv', '91a73557fe319a085dd598ce96fa8ace', 'LED', 380, 780, ['LED-B1', 'LED-B2', 'LED-B3', 'LED-B4', 'LED-B5', 'LED-BH1', 'LED-RGB1', 'LED-V1', 'LED-V2']],
]
let out = `//======================================================================================================================
// FOUR OF THE CIE'S TABLES, at 5 nm -- written by data/ciedata.make.mjs from the CIE's own CSVs (data/). Do not edit: run
// the script. Each table is { lo, step: 5, names, columns: { name: Float64Array } }.
//
// Sources (International Commission on Illumination (CIE), Vienna, AT):
//   TCS       CIE 1995, Spectral radiance factors of 14 test samples for the CIE colour rendering index calculation,
//             DOI: 10.25039/CIE.DS.wuiuu9cz
//   DAYLIGHT  CIE 2018, Components of the relative spectral distribution of daylight used in the calculation of relative
//             spectral power distributions of CIE daylight illuminants of different correlated colour temperatures
//   FL        CIE 2018, Relative spectral power distributions of illuminants representing typical fluorescent lamps,
//             DOI: 10.25039/CIE.DS.ukaymjdn
//   LED       CIE 2018, Relative spectral power distributions of illuminants representing typical LED lamps,
//             DOI: 10.25039/CIE.DS.vgssnyfg
// Licence: Creative Commons Attribution-ShareAlike 4.0 International (https://creativecommons.org/licenses/by-sa/4.0/),
// the CIE's for these tables; this file is the same numbers in another syntax, under the same licence (THIRD_PARTY.md).
//======================================================================================================================
`
for (const [file, md5want, name, lo, hi, names] of TABLES) {
    const csv = readFileSync(join(here, file))
    const md5 = createHash('md5').update(csv).digest('hex')
    if (md5 !== md5want) throw new Error(`${file} is not the CIE's (md5 ${md5})`)
    const rows = csv.toString().trim().split(/\r?\n/).map(l => l.split(',').map(Number))
    const n = (hi - lo) / 5 + 1
    if (rows.length !== n) throw new Error(`${file}: ${rows.length} rows, expected ${n}`)
    rows.forEach((r, i) => { if (r.length !== names.length + 1 || r[0] !== lo + 5 * i || r.some(v => !Number.isFinite(v))) throw new Error(`${file} row ${i + 1}: ${r}`) })
    out += `/** ${file} (md5 ${md5}): ${names.length} columns, ${lo}-${hi} nm at 5 nm */\n`
    out += `export const CIE_${name} = { lo: ${lo}, step: 5, names: ${JSON.stringify(names)}, columns: {\n`
    names.forEach((c, j) => { out += `    ${JSON.stringify(c)}: Float64Array.of(${rows.map(r => r[j + 1]).join(',')}),\n` })
    out += '} }\n'
}
writeFileSync(join(here, '..', 'ciedata.js'), out)
console.log('wrote ciedata.js')
