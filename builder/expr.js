//======================================================================================================================
// EXPRESSIONS IN A PATH'S OR A PROFILE'S POINTS -- `0.5, 0.5, rise`, `-w/2, 0, 0, r` (asked 2026-10-01: "define a
// parameter and use it as a variable in a path, to limit recompiling"; profiles 2026-10-02). A point's entry is a
// number, or a string read here: numbers, the node's own parameters by name (a vector's component as `corner.x`),
// unary minus, + - * / (and the × ÷ − a keyboard may give) and brackets. Nothing else: no functions, no other
// node's parameters.
//
// EVALUATED IN JS ONLY, never written into WGSL. Points become pieces (core/shapes.js pathPieces, profilePieces) on
// the CPU either way; compiled, those are literals, live, uniforms the builder rewrites when a parameter moves
// (codegen.js livePointsUpdate). So an expression costs the shader nothing, and there is one evaluator, this one,
// for the model, codegen, the bounds and the panel alike.
//
// Here and not in model.js because codegen needs the resolvers too, and model.js imports codegen.
//
// PURE: no DOM, no device. test/expr.test.mjs.
//======================================================================================================================

const NAME = /[A-Za-z][A-Za-z0-9_]*/y                   // a parameter's name (model.js PARAM)
const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
const OPS = { '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', '/': '/', '÷': '/', '(': '(', ')': ')', '.': '.' }

/** The text as tokens, each { t: 'num' | 'name' | an operator, v, at (0-based), end }; or { error, at }. */
function tokens(text) {
    const out = []
    for (let i = 0; i < text.length;) {
        const ch = text[i]
        if (/\s/.test(ch)) { i++; continue }
        NUMBER.lastIndex = i; NAME.lastIndex = i
        let m
        // a component after a dot is a name, not the start of a number
        if (out.at(-1)?.t !== '.' && (m = NUMBER.exec(text))) { out.push({ t: 'num', v: Number(m[0]), at: i, end: i + m[0].length }); i += m[0].length }
        else if ((m = NAME.exec(text))) { out.push({ t: 'name', v: m[0], at: i, end: i + m[0].length }); i += m[0].length }
        else if (OPS[ch]) { out.push({ t: OPS[ch], at: i, end: i + 1 }); i++ }
        else return { error: `'${ch}' is not part of an expression`, at: i + 1 }
    }
    return out
}

/**
 * Read an expression: { ast } or { error, at } (at: the 1-based column). The AST is { num }, { name, comp?, at },
 * { neg }, or { op, a, b }.
 */
export function parseExpr(text) {
    const toks = tokens(String(text))
    if (toks.error) return toks
    if (!toks.length) return { error: 'empty', at: 1 }
    let i = 0
    const peek = () => toks[i], col = () => (toks[i]?.at ?? String(text).length) + 1
    const fail = msg => { throw { error: msg, at: col() } }
    const atom = () => {
        const t = toks[i]
        if (!t) fail('the expression ends too soon')
        if (t.t === 'num') { i++; return { num: t.v } }
        if (t.t === 'name') {
            i++
            if (peek()?.t !== '.') return { name: t.v, at: t.at + 1 }
            i++
            const c = toks[i]
            if (c?.t !== 'name' || !['x', 'y', 'z'].includes(c.v)) fail('a component is .x, .y or .z')
            i++
            return { name: t.v, comp: c.v, at: t.at + 1 }
        }
        if (t.t === '(') {
            i++
            const e = sum()
            if (peek()?.t !== ')') fail('a bracket is not closed')
            i++
            return e
        }
        fail(t.t === ')' ? 'a bracket closes nothing' : `'${String(text).slice(t.at, t.end)}' cannot start a value`)
    }
    const unary = () => {
        const t = peek()?.t
        if (t === '-') { i++; return { neg: unary() } }
        if (t === '+') { i++; return unary() }
        return atom()
    }
    const product = () => {
        let a = unary()
        while (peek()?.t === '*' || peek()?.t === '/') { const op = toks[i++].t; a = { op, a, b: unary() } }
        return a
    }
    const sum = () => {
        let a = product()
        while (peek()?.t === '+' || peek()?.t === '-') { const op = toks[i++].t; a = { op, a, b: product() } }
        return a
    }
    try {
        const ast = sum()
        if (i < toks.length) fail(toks[i].t === ')' ? 'a bracket closes nothing' : `'${String(text).slice(toks[i].at, toks[i].end)}' does not belong here`)
        return { ast }
    } catch (e) {
        if (e && 'error' in e) return e
        throw e
    }
}

/** The value of an AST, lookup(name, comp) giving each name's number (undefined if it has none). */
export function evalExpr(ast, lookup) {
    if ('num' in ast) return ast.num
    if ('name' in ast) return lookup(ast.name, ast.comp)
    if ('neg' in ast) return -evalExpr(ast.neg, lookup)
    const a = evalExpr(ast.a, lookup), b = evalExpr(ast.b, lookup)
    return ast.op === '+' ? a + b : ast.op === '-' ? a - b : ast.op === '*' ? a * b : a / b
}

/** Every name an AST reads: [{ name, comp, at }], in order. */
export function namesOf(ast, out = []) {
    if ('name' in ast) out.push({ name: ast.name, comp: ast.comp, at: ast.at })
    else if ('neg' in ast) namesOf(ast.neg, out)
    else if ('op' in ast) { namesOf(ast.a, out); namesOf(ast.b, out) }
    return out
}

/** The text with every reading of the name `from` written `to` -- a whole name, never a component or part of a
 *  longer name -- and everything else as it was. Text that does not read is returned unchanged. */
export function renameIn(text, from, to) {
    const toks = tokens(String(text))
    if (toks.error) return text
    let out = String(text)
    for (let k = toks.length - 1; k >= 0; k--) {
        const t = toks[k]
        if (t.t === 'name' && t.v === from && toks[k - 1]?.t !== '.') out = out.slice(0, t.at) + to + out.slice(t.end)
    }
    return out
}

//======================================================================================================================
// A PATH'S OR A PROFILE'S POINTS, RESOLVED against the node's parameters
//======================================================================================================================

/* what a point is in each: a path's x, y, z, a fillet, and the cross-section's scale x, scale y and twist there (3 to
   7 entries, the ones left off at the end their defaults -- no fillet, scale 1, scale y as scale x, no twist; an open
   line whose ends have no corner; the user, 2026-10-02: a tube's diameter and a sweep's section per point); a
   profile's x, y and a fillet (2 or 3, a closed outline, every point a corner). `fillet` is the fillet's index. */
const PATH = { what: 'a path', coords: ['x', 'y', 'z', 'fillet', 'scale x', 'scale y', 'twist'], min: 3, fillet: 3, ends: true,
               says: 'x, y, z, then a fillet, scale x, scale y and twist if it has them' }
const PROFILE = { what: 'a profile', coords: ['x', 'y', 'fillet'], min: 2, fillet: 2, ends: false,
                  says: 'x, y, and a fillet radius if it has one' }

/** The names a list of points reads (each once, in order): what it depends on. */
export function pointNames(list) {
    const seen = new Set()
    for (const pt of Array.isArray(list) ? list : []) for (const c of Array.isArray(pt) ? pt : [])
        if (typeof c === 'string') { const r = parseExpr(c); if (r.ast) for (const n of namesOf(r.ast)) seen.add(n.name) }
    return [...seen]
}

/** Where a list of points reads a name: the 1-based number of the first point that does, or 0. */
export function pointUses(list, name) {
    const i = (Array.isArray(list) ? list : []).findIndex(pt => Array.isArray(pt) && pt.some(c => typeof c === 'string' && (() => {
        const r = parseExpr(c)
        return !!r.ast && namesOf(r.ast).some(n => n.name === name)
    })()))
    return i + 1
}

/**
 * Points as numbers, read against `params` (the node's own): { points, problems }. The PROBLEMS are the ones no
 * value of a parameter could put right -- an entry that does not read, a name the node has no number for, a path's
 * end given a fillet by a name, a point with the wrong count of entries -- each said by its point (and which entry).
 * Whether the numbers make a sound path or outline is pathPieces' or profilePieces' to say, and it can change as a
 * slider moves. `points` is filled either way, NaN where an entry could not be read.
 */
function resolvePoints(params, pts, form) {
    const problems = [], { coords } = form, n = coords.length
    if (!Array.isArray(pts)) return { points: [], problems: [`${form.what} is a list of points`] }
    const lookup = (where, out) => (name, comp) => {
        const v = params?.[name]
        if (typeof v === 'number' && comp === undefined) return v
        if (v && typeof v === 'object' && !Array.isArray(v) && 'x' in v && typeof v.x === 'number') {
            if (comp !== undefined && typeof v[comp] === 'number') return v[comp]
            out.push(comp === undefined ? `${where}: '${name}' is a vector -- say ${name}.x, ${name}.y${'z' in v ? ` or ${name}.z` : ''}`
                : `${where}: '${name}' has no ${comp}`)
            return NaN
        }
        out.push(v === undefined ? `${where}: no parameter '${name}'` : `${where}: '${name}' is not a number`)
        return NaN
    }
    const points = pts.map((pt, i) => {
        if (!Array.isArray(pt) || pt.length < form.min || pt.length > n) {
            problems.push(`point ${i + 1}: ${form.says}`)
            return Array(form.min).fill(NaN)
        }
        return pt.map((c, j) => {
            const where = `point ${i + 1}, ${coords[j]}`
            if (typeof c === 'number') return c
            if (typeof c !== 'string') { problems.push(`${where}: a number or an expression`); return NaN }
            if (form.ends && j === form.fillet && (i === 0 || i === pts.length - 1)) { problems.push(`point ${i + 1}: an end has no corner to round`); return NaN }
            const r = parseExpr(c)
            if (r.error) { problems.push(`${where}: "${c}": ${r.error} (column ${r.at})`); return NaN }
            return evalExpr(r.ast, lookup(where, problems))
        })
    })
    return { points, problems }
}
/** A path's ({ path }) points, resolved. */
/* HOW MANY POINTS A LIVE PATH OR PROFILE MAY HAVE: its pieces are uniforms, and nothing checks the uniform struct's
   64 KiB. Here, beside the resolvers, because the model refuses a longer one made live and codegen will not force
   one live while it is edited (codegen.js emitScene editing), and model.js imports codegen. */
export const LIVE_PATH_MAX = 64      // a live path's points: its pieces are ~144 bytes of uniforms a point, 192 varying (codegen.js)
export const LIVE_PROFILE_MAX = 64   // a live profile's points: one 32-byte uniform a piece, two pieces a filleted point
export const resolvePath = (params, value) => resolvePoints(params, value?.path, PATH)
/** A profile's (a bare list) points, resolved. */
export const resolveProfile = (params, list) => resolvePoints(params, list, PROFILE)
/** What a path reads, and where. */
export const pathNames = value => pointNames(value?.path)
export const pathUses = (value, name) => pointUses(value?.path, name)
