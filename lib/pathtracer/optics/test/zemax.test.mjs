// node lib/pathtracer/optics/test/zemax.test.mjs
//
// The Zemax source file reader against files written here with known contents -- both record formats,
// the units, the file's own placement, and the refusals -- and, when it is on this machine, against
// the real ams-OSRAM file the old tool shipped (set ZEMAX_SAMPLE to its path; it is not in the repo:
// 2.8 MB). Written with writeZemax, so the two are checked against each other and against the layout.
import { readFileSync, existsSync } from 'fs'
import { parseZemax, writeZemax, ZEMAX_HEADER_BYTES, RAY_FLOATS } from '../zemax.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol

const rays = [
    { pos: [1, 2, 3], dir: [0, 0, 2], flux: 0.25, wavelength: 0.45 },
    { pos: [-1, 0, 0.5], dir: [1, 1, 0], flux: 0.75, wavelength: 0.65 },
]
{
    const f = parseZemax(writeZemax(rays, { description: 'test LED', units: 4 }))
    ok('format 0: the header reads back', f.header.count === 2 && f.header.description === 'test LED' && f.header.identifier === 8675309)
    ok('...the size is header + 7 floats a ray', writeZemax(rays).byteLength === ZEMAX_HEADER_BYTES + 2 * 7 * 4)
    ok('...positions in METRES: an mm file scaled by 1e-3', near(f.rays[0], 0.001) && near(f.rays[2], 0.003))
    ok('...directions unit', near(Math.hypot(f.rays[4], f.rays[5], f.rays[6]), 1) && near(f.rays[RAY_FLOATS + 4], Math.SQRT1_2))
    ok('...fluxes, and their total', near(f.rays[3], 0.25) && near(f.rays[RAY_FLOATS + 3], 0.75) && near(f.total, 1))
    ok('...watts unless it says lumens', f.header.fluxUnit === 'W' && parseZemax(writeZemax(rays, { fluxType: 1 })).header.fluxUnit === 'lm')
}
{
    const f = parseZemax(writeZemax(rays, { format: 2, units: 0 }))
    ok('format 2 (spectral): 8 floats a ray, each its own wavelength', near(f.rays[7], 0.45) && near(f.rays[RAY_FLOATS + 7], 0.65)
        && near(f.rays[RAY_FLOATS], -1))
    ok('...in metres as they are', near(f.rays[1], 2))
}
{
    const f = parseZemax(writeZemax(rays, { units: 2, loc: [10, 0, 0] }))
    ok('the file\'s location is added before the units: cm', near(f.rays[0], (1 + 10) * 0.01))
    const r = parseZemax(writeZemax([{ pos: [1, 0, 0], dir: [1, 0, 0], flux: 1 }], { units: 0, rot: [0, 0, Math.PI / 2] }))
    ok('its rotation turns positions and directions (z by 90: x to y), and says it was applied',
        near(r.rays[0], 0) && near(r.rays[1], 1) && near(r.rays[5], 1) && r.header.rotated)
}
{
    const bad = writeZemax(rays)
    let threw = null
    try { parseZemax(bad.slice(0, bad.byteLength - 4)) } catch (e) { threw = e.message }
    ok('a file shorter than its header says is refused, with the numbers', /bytes/.test(threw || ''), threw)
    const f2 = new DataView(writeZemax(rays)); f2.setInt32(ZEMAX_HEADER_BYTES - 16, 5, true)
    threw = null
    try { parseZemax(f2.buffer) } catch (e) { threw = e.message }
    ok('an unknown ray format is refused', /format 5/.test(threw || ''), threw)
}

// THE REAL FILE, if it is here: 100 000 rays, 0.875 W, mm, flux-only, and the rays' flux adds up to the header's
const sample = process.env.ZEMAX_SAMPLE || '/home/user/raytracer/ZEMAXRAYFILE.DAT'
if (existsSync(sample)) {
    const f = parseZemax(readFileSync(sample))
    ok('OSRAM file: 100 000 rays, 0.875 W, mm, format 0',
        f.header.count === 100000 && near(f.header.sourceFlux, 0.875) && f.header.units === 'mm' && f.header.format === 0)
    ok('OSRAM file: the rays carry the header\'s flux', near(f.total, f.header.sourceFlux, 1e-5), `${f.total}`)
    let maxR = 0
    for (let k = 0; k < f.header.count; k++) maxR = Math.max(maxR, Math.abs(f.rays[k * RAY_FLOATS]))
    ok('OSRAM file: a few millimetres across, in metres', maxR > 1e-3 && maxR < 3e-3, `${maxR}`)
} else console.log(`(the OSRAM sample is not at ${sample}: its checks skipped)`)

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
