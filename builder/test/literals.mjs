//======================================================================================================================
// A MATERIAL'S NUMBERS ARE ITS PARAMETERS (the user, 2026-09-30: "when materials have colors, add them as
// uniforms -- same for other properties, e.g. marble line, scale"). What a person would want to change -- a
// colour, a size -- is a parameter, a slider and a uniform, not a number inside the code. This finds the two
// kinds a check can tell apart from the code's own arithmetic, in the code without its comments:
//   a COLOUR    a VEC3 / vec3<f32> of plain numbers that is not an axis (one component +-1, the others 0:
//               grainAlong's direction is not a colour)
//   a LENGTH    perMm(...), mm(...) or metres(...) of a plain number -- all but mm(1.0), which is the unit
//               itself (the template's `p_local * S_local / mm(1.0)`, the point in mm)
// Used by library/test/store.test.mjs (every built-in material) and builder/test/scenes.test.mjs (every
// bundled scene's). A shape's own constant -- the 0.5 + 0.5 of a noise, a seed -- is not either, and stays.
//======================================================================================================================
const NUM = /^\s*[-+]?[\d.]+(?:\s*\/\s*[\d.]+)?\s*$/
const isAxis = args => {
    const v = args.map(a => +a)
    return v.length === 3 && v.every(Number.isFinite) && v.filter(x => x !== 0).length === 1 && v.some(x => Math.abs(x) === 1)
}
/** The literals in `code` that should be parameters: ['VEC3(0.36, 0.2, 0.1)', 'perMm(1.0 / 8.0)', ...]. */
export function literalsIn(code) {
    const c = String(code || '').replace(/\/\/.*$/mg, '')
    const out = []
    for (const [all, inner] of c.matchAll(/(?:VEC3|vec3<f32>|vec3f)\(([^()]*)\)/g)) {
        const args = inner.split(',')
        if (args.every(a => NUM.test(a)) && !(args.length === 3 && isAxis(args))) out.push(all)
    }
    for (const [all, fn, arg] of c.matchAll(/\b(perMm|mm|metres)\(([^()]*)\)/g))
        if (NUM.test(arg) && !(fn === 'mm' && +arg === 1)) out.push(all)
    return out
}
