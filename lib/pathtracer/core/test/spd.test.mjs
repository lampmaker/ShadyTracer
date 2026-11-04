// node lib/pathtracer/core/test/spd.test.mjs
//
// core/spd.js and core/cie1931.js: a light given by its spectrum (0.next; roadmap/LIGHT_MODEL.md S1). The CIE's table as
// the CIE publishes it (the module against its CSV, number for number; the sums and values everyone quotes); Planck
// against the CIE's illuminant A and the Planckian locus; peaks' areas, a line's colour and efficacy, a laser line beside
// a broad hump; a table read from CSV, in a European spreadsheet's form too, and every problem at its line and column;
// the presets where their labels say; the refusals; a spectral Zemax file's colour (format 2 only). No GPU.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CIE_LO, CIE_N, CIE_X, CIE_Y, CIE_Z } from '../cie1931.js'
import { cieAt, spdAt, spdXYZ, spdPower, spdLER, spdRGB, spdSummary, spdProblems, parseSpdCsv, parsePeaks, peaksText, tableText,
         SPD_PRESETS, SpdTextError, C2, KM } from '../spd.js'
import { XYZtoxy, xyToCctDuv, planckXy, rgbToXYZ } from '../colorimetry.js'
import { writeZemax, parseZemax, raysXYZ } from '../../optics/zemax.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol
const throwsAt = (name, fn, line, col, match) => {
    try { fn() } catch (e) {
        ok(name, e instanceof SpdTextError && e.line === line && (col == null || e.col === col) && (!match || match.test(e.message)), `${e.message} (line ${e.line}, col ${e.col})`)
        return
    }
    ok(name, false, 'did not throw')
}

{
    // THE TABLE: the module is the CSV, number for number, and the CSV the CIE's (the make script checks its md5)
    const here = dirname(fileURLToPath(import.meta.url))
    const rows = readFileSync(join(here, '..', 'data', 'CIE_xyz_1931_2deg.csv'), 'utf8').trim().split(/\r?\n/).map(l => l.split(',').map(Number))
    ok('471 rows, 360-830 nm at 1 nm', CIE_N === 471 && CIE_LO === 360 && rows.length === 471 && rows.every((r, i) => r[0] === 360 + i))
    ok('every value the CSV\'s exactly', rows.every((r, i) => r[1] === CIE_X[i] && r[2] === CIE_Y[i] && r[3] === CIE_Z[i]))
    // the sums at 1 nm everyone quotes (CIE 015), and y-bar 1 at 555 nm
    const sum = a => a.reduce((s, v) => s + v, 0)
    ok('the sums 106.865, 106.857, 106.892', near(sum(CIE_X), 106.865, 1e-3) && near(sum(CIE_Y), 106.857, 1e-3) && near(sum(CIE_Z), 106.892, 1e-3),
       `${sum(CIE_X)} ${sum(CIE_Y)} ${sum(CIE_Z)}`)
    ok('y-bar is 1 at 555 nm', CIE_Y[555 - 360] === 1)
    ok('...and the table between rows linear, 0 outside', near(cieAt(555.5)[1], (CIE_Y[195] + CIE_Y[196]) / 2, 1e-15) && cieAt(359.9)[1] === 0 && cieAt(830.1)[0] === 0)
}
{
    // PLANCK: the CIE's illuminant A (2848 K with c2 1.435e-2, CIE 015) at its published xy; the locus
    const A = SPD_PRESETS['CIE illuminant A']
    ok('illuminant A is 2848 K of the old c2: the same curve', near(A.T, 2848 * C2 / 1.435e-2, 1e-3))
    const xy = XYZtoxy(spdXYZ(A))
    ok('illuminant A: xy (0.44757, 0.40745) within 2e-5', near(xy[0], 0.44757, 2e-5) && near(xy[1], 0.40745, 2e-5), xy.join(' '))
    /* the blackbody on the Planckian locus: CCT back within the locus's own fit (Krystek's, colorimetry.js: about 3e-4 in
       xy). Measured here 2026-11-03: within 0.12 mired at 2000-6500 K, 0.18 at 10 000 K (18 K), |Duv| at most 1.3e-4 */
    let worst = 0, worstDuv = 0
    for (const T of [2000, 2700, 3000, 4000, 5000, 6500, 10000]) {
        const s = spdSummary({ kind: 'planck', T })
        worst = Math.max(worst, Math.abs(1e6 / s.cct - 1e6 / T))
        worstDuv = Math.max(worstDuv, Math.abs(s.duv))
    }
    ok('a blackbody\'s CCT is its temperature within 0.25 mired, Duv within 2e-4 (the locus\'s own fit)', worst < 0.25 && worstDuv < 2e-4, `${worst} ${worstDuv}`)
    // its efficacy: a blackbody's well known values, 2856 K about 15 lm/W, 6500 K about 95
    ok('efficacy: illuminant A 16.4 lm/W, 6500 K 95 lm/W', near(spdLER(A), 16.4, 0.3) && near(spdLER({ kind: 'planck', T: 6500 }), 95.4, 1),
       `${spdLER(A)} ${spdLER({ kind: 'planck', T: 6500 })}`)
    ok('...and its total power its integral (Stefan-Boltzmann: T^4)', near(spdPower({ kind: 'planck', T: 4000 }) / spdPower({ kind: 'planck', T: 2000 }), 16, 1e-3))
}
{
    // PEAKS: a Gaussian's area its weight; a line's colour the table's at that wavelength, its efficacy KM y-bar
    const p = { kind: 'peaks', peaks: [{ nm: 550, fwhm: 30, weight: 2 }] }
    let area = 0
    for (let l = 400; l <= 700; l += 0.01) area += spdAt(p, l) * 0.01
    ok('a peak\'s area its weight', near(area, 2, 1e-6) && spdPower(p) === 2, String(area))
    for (const nm of [450, 520, 600, 700]) {
        const line = { kind: 'peaks', peaks: [{ nm, fwhm: 0.01, weight: 1 }] }
        const xy = XYZtoxy(spdXYZ(line)), want = XYZtoxy([CIE_X[nm - 360], CIE_Y[nm - 360], CIE_Z[nm - 360]])
        // within 5e-6: a line on a table row straddles the kink the linear interpolation has there
        ok(`a 0.01 nm line at ${nm}: the table's chromaticity there`, near(xy[0], want[0], 5e-6) && near(xy[1], want[1], 5e-6), `${xy} ${want}`)
        ok(`...its efficacy KM y-bar(${nm})`, near(spdLER(line), KM * CIE_Y[nm - 360], 1e-3 * KM * CIE_Y[nm - 360] + 1e-6), `${spdLER(line)}`)
    }
    // a laser line beside a broad hump: each where it is, in about the time of the two apart
    const both = { kind: 'peaks', peaks: [{ nm: 450, fwhm: 20, weight: 1 }, { nm: 700, fwhm: 0.01, weight: 1 }] }
    const t0 = performance.now(); spdXYZ({ ...both, peaks: [...both.peaks, { nm: 500, fwhm: 1, weight: 0 }] }); const dt = performance.now() - t0
    const a = spdXYZ({ kind: 'peaks', peaks: [both.peaks[0]] }), b = spdXYZ({ kind: 'peaks', peaks: [both.peaks[1]] }), ab = spdXYZ(both)
    ok('two peaks add: each one\'s XYZ', ab.every((v, i) => near(v, a[i] + b[i], 1e-12 * Math.max(1, v))))
    ok('...a laser line beside a hump costs under 50 ms (each peak summed where it is)', dt < 50, `${dt} ms`)
    // the colour: exact RGB at Y = 1, a channel below 0 for a royal blue outside the gamut
    const rgb = spdRGB({ kind: 'peaks', peaks: [{ nm: 450, fwhm: 20, weight: 1 }] })
    const back = rgbToXYZ(rgb)
    ok('a royal blue: Y 1, a channel below 0, its xy back exactly', near(back[1], 1, 1e-12) && Math.min(...rgb) < 0
        && near(XYZtoxy(back)[0], spdSummary({ kind: 'peaks', peaks: [{ nm: 450, fwhm: 20, weight: 1 }] }).xy[0], 1e-12))
}
{
    // A TABLE: linear between points, 0 outside; read from CSV, a spreadsheet's European form too
    const t = { kind: 'table', name: 't', points: [[500, 0], [550, 1], [600, 0]] }
    ok('a table linear between points, 0 outside', spdAt(t, 525) === 0.5 && spdAt(t, 499) === 0 && spdAt(t, 601) === 0 && spdPower(t) === 50)
    const fromPeak = { kind: 'peaks', peaks: [{ nm: 560, fwhm: 40, weight: 1 }] }
    const pts = []
    for (let l = 450; l <= 670; l += 1) pts.push([l, spdAt(fromPeak, l)])
    const a = XYZtoxy(spdXYZ({ kind: 'table', points: pts })), b = XYZtoxy(spdXYZ(fromPeak))
    ok('a peak sampled every 1 nm as a table: the same colour within 1e-5', near(a[0], b[0], 1e-5) && near(a[1], b[1], 1e-5), `${a} ${b}`)
    const csv = '# a measured LED\nWavelength (nm),Relative\n450,0.2\n460,  1\n470,0.4\n\n480,0.1,extra column\n'
    const r = parseSpdCsv(csv)
    ok('CSV: a comment and a heading skipped, a blank line, a further column ignored', JSON.stringify(r.points) === '[[450,0.2],[460,1],[470,0.4],[480,0.1]]', JSON.stringify(r.points))
    ok('...a semicolon one with decimal commas (a European spreadsheet\'s)', JSON.stringify(parseSpdCsv('nm;rel\n450,5;0,25\n451;1').points) === '[[450.5,0.25],[451,1]]')
    ok('...tabs', JSON.stringify(parseSpdCsv('450\t1\n460\t2').points) === '[[450,1],[460,2]]')
    throwsAt('...a power not a number: its line and column', () => parseSpdCsv('450,1\n460,x'), 2, 5, /'x' is not a number/)
    throwsAt('...a wavelength not above the one before', () => parseSpdCsv('450,1\n460,1\n455,1'), 3, 1, /not above/)
    throwsAt('...a negative power', () => parseSpdCsv('450,1\n460,-1'), 2, 5, /below 0/)
    throwsAt('...one column', () => parseSpdCsv('450,1\n460'), 2, null, /two columns/)
    throwsAt('...one point only', () => parseSpdCsv('450,1'), 1, 1, /two points/)
    // text there and back
    ok('a table\'s text read back the same', JSON.stringify(parseSpdCsv(tableText({ points: r.points })).points) === JSON.stringify(r.points))
}
{
    // PEAKS AS TEXT: one a line, weight 1 if left out; problems at their line and column
    eq('peaks read: "nm fwhm weight", the weight 1 if left out, # comments',
        parsePeaks('# a white LED\n450 20 1\n580, 125, 5.35\n630 17').peaks,
        [{ nm: 450, fwhm: 20, weight: 1 }, { nm: 580, fwhm: 125, weight: 5.35 }, { nm: 630, fwhm: 17, weight: 1 }])
    throwsAt('...a FWHM not a number', () => parsePeaks('450 20 1\n580 wide 2'), 2, 5, /fwhm/)
    throwsAt('...four numbers', () => parsePeaks('450 20 1 9'), 1, 10, /three numbers at most/)
    throwsAt('...one number', () => parsePeaks('450'), 1, 1, /nm fwhm weight/)
    throwsAt('...none', () => parsePeaks('# nothing'), 1, 1, /no peak/)
    const p = SPD_PRESETS['LED white, about 4000 K (blue die and phosphor)']
    eq('...and back: a preset\'s text reads as the preset', parsePeaks(peaksText(p)).peaks, p.peaks)
}
{
    // THE PRESETS where their labels say, every one sound
    for (const [k, s] of Object.entries(SPD_PRESETS)) ok(`preset '${k}' is sound`, spdProblems(s).length === 0, spdProblems(s).join('; '))
    const w = spdSummary(SPD_PRESETS['LED white, about 4000 K (blue die and phosphor)'])
    ok('the white LED: 3990 K within 30 K, on the locus (|Duv| < 0.001)', near(w.cct, 3990, 30) && Math.abs(w.duv) < 1e-3, `${w.cct} ${w.duv}`)
    ok('...its efficacy a white LED\'s, 300-370 lm/W', w.ler > 300 && w.ler < 370, String(w.ler))
    ok('the blackbodies at their temperatures within 0.1 %', ['2700', '4000', '6500'].every(T => near(spdSummary(SPD_PRESETS[`blackbody ${T} K`]).cct, +T, +T * 1e-3)))
    for (const [k, nm] of [['LED royal blue 450 nm', 450], ['LED red 630 nm', 630], ['LED deep red 660 nm', 660]]) {
        const s = SPD_PRESETS[k]
        ok(`'${k}': one peak at ${nm} nm`, s.peaks.length === 1 && s.peaks[0].nm === nm)
    }
    // the deep red the analytic fit got wrong: on the spectrum locus's red end, not the fit's 0.568
    ok('a 660 nm LED: x above 0.72 (the analytic fit curled back past 644 nm)', spdSummary(SPD_PRESETS['LED deep red 660 nm']).xy[0] > 0.72)
}
{
    // THE REFUSALS, each said
    const bad = s => spdProblems(s).join('; ')
    ok('no object, an unknown kind', /object/.test(bad(null)) && /kind/.test(bad({ kind: 'laser' })))
    ok('a key not its kind\'s', /not a setting of a planck/.test(bad({ kind: 'planck', T: 3000, peaks: [] })))
    ok('a temperature out of range', /T must be/.test(bad({ kind: 'planck', T: 100 })))
    ok('no peaks, nine peaks', /1 to 8/.test(bad({ kind: 'peaks', peaks: [] })) && /1 to 8/.test(bad({ kind: 'peaks', peaks: Array(9).fill({ nm: 500, fwhm: 10, weight: 1 }) })))
    ok('a peak\'s nm, fwhm or weight wrong', /nm must/.test(bad({ kind: 'peaks', peaks: [{ nm: 5000, fwhm: 10, weight: 1 }] }))
        && /fwhm must/.test(bad({ kind: 'peaks', peaks: [{ nm: 500, fwhm: 0, weight: 1 }] }))
        && /weight must/.test(bad({ kind: 'peaks', peaks: [{ nm: 500, fwhm: 10, weight: -1 }] })))
    ok('a table\'s points out of order, or negative', /above the one before/.test(bad({ kind: 'table', points: [[500, 1], [500, 1]] }))
        && /power must be/.test(bad({ kind: 'table', points: [[500, 1], [510, -1]] })))
    ok('light the eye does not see: no colour', /no light the eye sees/.test(bad({ kind: 'peaks', peaks: [{ nm: 1000, fwhm: 10, weight: 1 }] })))
    ok('...an IR tail beside visible light is fine, and counts in the power only', spdProblems({ kind: 'peaks', peaks: [{ nm: 550, fwhm: 20, weight: 1 }, { nm: 1000, fwhm: 10, weight: 1 }] }).length === 0
        && near(spdLER({ kind: 'peaks', peaks: [{ nm: 550, fwhm: 20, weight: 1 }, { nm: 1000, fwhm: 10, weight: 1 }] }), spdLER({ kind: 'peaks', peaks: [{ nm: 550, fwhm: 20, weight: 1 }] }) / 2, 1e-6))
}
{
    // A SPECTRAL ZEMAX FILE'S COLOUR (zemax.js raysXYZ): its rays' wavelengths, by their flux; format 0 none
    const ray = (nm, flux) => ({ pos: [0, 0, 0], dir: [0, 0, 1], flux, wavelength: nm / 1000 })
    const blueRed = parseZemax(writeZemax([ray(450, 1), ray(450, 1), ray(630, 2)], { format: 2, fluxType: 0 }))
    const c = raysXYZ(blueRed)
    const want = [0, 1, 2].map(i => 2 * [CIE_X, CIE_Y, CIE_Z][i][90] + 2 * [CIE_X, CIE_Y, CIE_Z][i][270])
    ok('format 2, watts: the XYZ of each ray at its wavelength, by its watts', c?.rays === 3 && c.xyz.every((v, i) => near(v, want[i], 1e-5 * want[i] + 1e-9)), JSON.stringify(c))
    const lm = raysXYZ(parseZemax(writeZemax([ray(450, 1), ray(630, 1)], { format: 2, fluxType: 1 })))
    ok('...lumens: each ray its luminous flux (Y the lumens added)', near(lm.xyz[1], 2, 1e-5), JSON.stringify(lm))
    ok('a flux-only file (format 0), whatever its header wavelength: none -- 0.55 um is a common placeholder',
        raysXYZ(parseZemax(writeZemax([ray(450, 1)], { format: 0, wavelength: 0.55 }))) === null)
    ok('...and a spectral file the eye sees nothing of: none', raysXYZ(parseZemax(writeZemax([ray(1200, 1)], { format: 2 }))) === null)
}

function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`) }
console.log(`spd: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
