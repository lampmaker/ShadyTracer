//======================================================================================================================
// A SETTING DROPPED INTO THE SCRIPT (0.82.0; the user, 2026-11-03: "drag parameters from the parameter tab into the
// script"): the Parameters panel's row dragged onto the editor becomes code that names it -- the binding
//
//     const lensRadius = param('scene/n4/radius')   // lens › radius
//
// on a line of its own, or only `param('scene/n4/radius')` where it lands inside code (after `const r = `, inside a
// call). Which one is read off the line it lands on (dropEdit). Pure: tools/test/script.test.mjs drives it; the editor
// (tools/script.js) turns the pointer into a line and a column, and the panel (lib/shell/paramspanel.js) says what was
// dragged under PARAM_MIME.
//======================================================================================================================

import { SCRIPT_NAMES } from './scriptapi.js'

/** The drag's type for a setting: { path, label, kind, unit } as JSON. lib/shell/paramspanel.js sets it (its own copy of
 *  the string: the shell does not import the tools). */
export const PARAM_MIME = 'application/x-shadytracer-param'

const RESERVED = new Set([...SCRIPT_NAMES, 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
    'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
    'let', 'new', 'null', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while',
    'with', 'yield', 'undefined', 'NaN', 'Infinity', 'arguments', 'eval', 'Math', 'JSON', 'Object', 'Array', 'Number', 'String'])

/** The names the code declares (const, let, var, function, and a destructuring's plain names) -- what a new one must
 *  not take. A look at the text, not a parse: a name it misses costs a duplicate, which the run then reports. */
export function declaredNames(code) {
    const out = new Set()
    const s = String(code ?? '')
    for (const m of s.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1])
    for (const m of s.matchAll(/\b(?:const|let|var)\s*[[{]([^\]}=]*)[\]}]/g))
        for (const w of m[1].split(',')) { const n = /([A-Za-z_$][\w$]*)\s*$/.exec(w.trim()); if (n) out.add(n[1]) }
    return out
}

/** A variable's name for a setting, from its label ("lens › radius" -> lensRadius, "Sphere 2 › position" ->
 *  sphere2Position): the words in camelCase, never a keyword or one of the script's own names, and not one `taken`
 *  (a number added: lensRadius2). */
export function nameFor(label, taken = new Set()) {
    const words = String(label ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .split(/[^A-Za-z0-9]+/).filter(Boolean)
    let name = words.map((w, i) => i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1)).join('') || 'setting'
    if (/^\d/.test(name)) name = `p${name}`
    if (name.length > 40) name = name.slice(0, 40)
    if (RESERVED.has(name)) name += 'Param'
    let out = name, k = 2
    while (taken.has(out) || RESERVED.has(out)) out = `${name}${k++}`
    return out
}

/** A path as a JavaScript string, in the editor's quotes. */
const quoted = path => `'${String(path).replace(/[\\']/g, '\\$&')}'`

/** Where a line and a column on screen are in the code: { offset, past (to the right of the line's end), below (under
 *  the last line) }. `col` counts screen columns: a tab reaches the next multiple of `tab`. */
export function offsetAt(code, line, col, { tab = 4 } = {}) {
    const lines = String(code ?? '').split('\n')
    if (line < 0) line = 0
    if (line >= lines.length) return { offset: code.length, past: true, below: true }
    let offset = 0
    for (let i = 0; i < line; i++) offset += lines[i].length + 1
    const L = lines[line]
    let x = 0, j = 0
    while (j < L.length) {
        const w = L[j] === '\t' ? tab - (x % tab) : 1
        if (col < x + w / 2) break
        x += w; j++
    }
    return { offset: offset + j, past: j === L.length && col > x, below: false }
}

/** WHAT A DROP DOES, at `at` ({ offset, past, below } as offsetAt gives it) in `code`, for the setting `item` ({ path,
 *  label, kind, unit }): the edit { from, to, text } and where the caret goes after it.
 *  - on a line with nothing on it: the binding, `const <name> = param('<path>')   // <label>`, at the line's indent;
 *  - under the last line, or to the right of a line that is finished: the binding on a new line after it;
 *  - anywhere in code, or after a line that goes on (it ends in = ( [ , and the like -- not {, which opens a block):
 *    `param('<path>')` alone. */
export function dropEdit(code, at, item) {
    const s = String(code ?? '')
    const call = `param(${quoted(item.path)})`
    const note = [item.label, item.kind === 'structural' ? 'compiles' : null].filter(Boolean).join(', ')
    const binding = `const ${nameFor(item.label ?? item.path.split('/').pop(), declaredNames(s))} = ${call}${note ? `   // ${note}` : ''}`
    const o = Math.max(0, Math.min(s.length, at.offset | 0))
    const start = s.lastIndexOf('\n', o - 1) + 1
    const endNl = s.indexOf('\n', o), end = endNl < 0 ? s.length : endNl
    const line = s.slice(start, end), indent = /^[ \t]*/.exec(line)[0]
    if (!line.trim()) {
        return { from: start + indent.length, to: end, text: binding, caret: start + indent.length + binding.length }
    }
    const goesOn = /(?:[=([,:?!+\-*/%&|<>]|\breturn|\bawait)\s*$/.test(line.replace(/\/\/.*$/, ''))
    if (at.below || (at.past && !goesOn)) {
        // a new line after this one, at its indent (one more after an opening brace)
        const more = /\{\s*$/.test(line) ? '    ' : ''
        const text = `\n${indent}${more}${binding}`
        return { from: end, to: end, text, caret: end + text.length }
    }
    const pos = at.past ? end : o
    const pad = /[\w$)\]]$/.test(s.slice(start, pos)) ? ' ' : ''
    return { from: pos, to: pos, text: pad + call, caret: pos + pad.length + call.length }
}
