//======================================================================================================================
// THE SCRIPT EDITOR'S COLOURS (tools/script.js, 0.82.0): JavaScript as HTML, each token in a span of its kind, for the
// layer drawn under the editor's transparent text.
//
//   highlightJS(code, { globals: SCRIPT_NAMES }) -> html
//
// ONE PASS, LEFT TO RIGHT, A TOKEN AT A TIME -- not a regular expression per kind run over the text, which colours a
// `//` inside a string as a comment and a `'` inside a comment as a string. What the pass knows of JavaScript is what
// colouring needs: comments, the three kinds of string with a template's `${...}` coloured as code (to any depth),
// numbers, keywords, a regular expression told from a division by what comes before it, a call, and the names the
// script is handed.
//
// THE TEXT IS NEVER CHANGED, only wrapped: the HTML's text is the code exactly, character for character, or the
// colours would drift away from the caret (tools/test/script.test.mjs holds it to that on every example). The
// guistuff property table has a highlighter of this kind, GLSL's only, in a submodule this repository does not change
// (CLAUDE.md).
//======================================================================================================================

const KEYWORDS = new Set(['async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
    'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'of',
    'return', 'static', 'super', 'switch', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'get', 'set'])
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'this'])
/* after these words an expression starts, so a `/` there opens a regular expression */
const BEFORE_EXPR = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'])

const esc = s => s.replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;')
const span = (kind, s) => `<span class="hl-${kind}">${esc(s)}</span>`
const isIdStart = c => /[A-Za-z_$À-￿]/.test(c)
const isId = c => /[\w$À-￿]/.test(c)

/** The code as HTML. `globals`: the names to colour as the script's own (the API it is handed). */
export function highlightJS(code, { globals = [] } = {}) {
    const G = globals instanceof Set ? globals : new Set(globals)
    const s = String(code ?? '')
    const n = s.length
    let i = 0

    /* code until the end, or -- inside a template's ${ -- until the } that closes it (returned without it) */
    function codeUntil(inTemplate) {
        let out = '', depth = 0
        let prev = ''                 // the last significant token: what decides whether a `/` is a regular expression
        while (i < n) {
            const c = s[i], d = s[i + 1]
            if (inTemplate && c === '}' && depth === 0) return out
            if (c === '/' && d === '/') { const e = s.indexOf('\n', i); const j = e < 0 ? n : e; out += span('com', s.slice(i, j)); i = j; continue }
            if (c === '/' && d === '*') { const e = s.indexOf('*/', i + 2); const j = e < 0 ? n : e + 2; out += span('com', s.slice(i, j)); i = j; continue }
            if (c === '"' || c === "'") {
                let j = i + 1
                while (j < n && s[j] !== c && s[j] !== '\n') j += s[j] === '\\' ? 2 : 1
                j = Math.min(n, j + (s[j] === c ? 1 : 0))
                out += span('str', s.slice(i, j)); i = j; prev = 'value'; continue
            }
            if (c === '`') { out += template(); prev = 'value'; continue }
            if (/\d/.test(c) || (c === '.' && /\d/.test(d ?? ''))) {
                const m = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)n?/.exec(s.slice(i, i + 64))
                const t = m?.[0] || c
                out += span('num', t); i += t.length; prev = 'value'; continue
            }
            if (isIdStart(c)) {
                let j = i + 1
                while (j < n && isId(s[j])) j++
                const w = s.slice(i, j)
                const afterDot = /\.\s*$/.test(s.slice(Math.max(0, i - 8), i)) && !/\.\.\.\s*$/.test(s.slice(Math.max(0, i - 8), i))
                let k = j
                while (k < n && (s[k] === ' ' || s[k] === '\t')) k++
                const call = s[k] === '('
                out += afterDot ? (call ? span('fn', w) : span('prop', w))
                    : KEYWORDS.has(w) ? span('kw', w)
                    : LITERALS.has(w) ? span('lit', w)
                    : G.has(w) ? span('api', w)
                    : call ? span('fn', w) : esc(w)
                i = j
                prev = BEFORE_EXPR.has(w) && !afterDot ? 'op' : 'value'
                continue
            }
            if (c === '/') {
                if (prev !== 'value') {                       // a regular expression: to its closing / outside a [class]
                    let j = i + 1, cls = false
                    while (j < n && s[j] !== '\n') {
                        if (s[j] === '\\') { j += 2; continue }
                        if (s[j] === '[') cls = true
                        else if (s[j] === ']') cls = false
                        else if (s[j] === '/' && !cls) break
                        j++
                    }
                    if (s[j] === '/') {
                        j++
                        while (j < n && /[a-z]/i.test(s[j])) j++
                        out += span('re', s.slice(i, j)); i = j; prev = 'value'; continue
                    }
                }
                out += '/'; i++; prev = 'op'; continue
            }
            if (c === '{') depth++
            else if (c === '}') depth--
            // a closing bracket ends a value (a / after it divides); any other mark starts an expression
            if (!/\s/.test(c)) prev = c === ')' || c === ']' || c === '}' ? 'value' : 'op'
            out += esc(c); i++
        }
        return out
    }
    /* a template literal from its opening backtick: its text a string, each ${...} code */
    function template() {
        let out = '', from = i
        i++
        while (i < n && s[i] !== '`') {
            if (s[i] === '\\') { i += 2; continue }
            if (s[i] === '$' && s[i + 1] === '{') {
                out += span('str', s.slice(from, i)) + span('tpl', '${')
                i += 2
                out += codeUntil(true)
                if (s[i] === '}') { out += span('tpl', '}'); i++ }
                from = i
                continue
            }
            i++
        }
        i = Math.min(n, i + 1)
        return out + span('str', s.slice(from, i))
    }
    return codeUntil(false)
}
