//======================================================================================================================
// EXCERPTS -- a piece of the real source, found by what it is called, never pasted into a page.
//
// A tutorial that copies code is wrong the day after the code changes, and nothing says so. So a page names a file and
// a symbol, and this finds the lines at view time (page.js) and in the test (tutorial/test/tutorial.test.mjs) -- the
// same function both times, so the test checks exactly what the page runs. Pure: text in, lines out, no DOM, no fetch.
//
//   locate(text, { sym, nth, within, to, max, doc })  ->  { first, last, lines, hash }   (lines 1-based, inclusive)
//
// WHAT `sym` MAY BE
//   'fn csgUnion'          a WGSL function (most of the engine is WGSL inside JS template strings)
//   'function trace'       a JS function, async or exported
//   'const raygenTiles'    a JS const / let / var, or 'class PhotonMap'
//   anything else          a literal piece of text, e.g. 'THE FLUSH.' or 'if (isPersp) {'
//
// HOW FAR IT REACHES
//   to: 'text'      through the first line, from the symbol's on, holding that text
//   otherwise       a symbol inside a block comment: to the comment's end;
//                   any other: from the first { at or after the symbol to the brace that closes it -- comments and
//                   quoted strings skipped, backticks NOT (the text inside them is shader code, braces and all)
//   doc: true       the comment directly above is included (the default for fn / function / const / class: that
//                   comment is usually the "why", which is the point of showing the code)
//   max             lines in all, 40 unless said: an extent that never closes fails instead of showing half a file
//
// AMBIGUITY IS AN ERROR. A symbol found twice (scene_api.js defines fn localPoint twice) needs nth (1-based) or
// within (a symbol whose line the search starts from). Errors are thrown with the reason; the page shows the reason.
//======================================================================================================================

const KINDS = [
    [/^fn\s+([\w]+)$/, n => new RegExp(`\\bfn\\s+${n}\\s*\\(`)],
    [/^function\s+([\w$]+)$/, n => new RegExp(`\\bfunction\\s*\\*?\\s+${n}\\s*\\(`)],
    [/^(?:const|let|var)\s+([\w$]+)$/, n => new RegExp(`\\b(?:const|let|var)\\s+${n}\\b`)],
    [/^class\s+([\w$]+)$/, n => new RegExp(`\\bclass\\s+${n}\\b`)],
]

/** What `sym` looks for: { test(line) -> column or -1, named } */
function matcher(sym) {
    for (const [re, make] of KINDS) {
        const m = re.exec(sym.trim())
        if (m) { const r = make(m[1]); return { named: true, test: l => { const x = r.exec(l); return x ? x.index : -1 } } }
    }
    return { named: false, test: l => l.indexOf(sym) }
}

/* A LEXER JUST GOOD ENOUGH TO MATCH BRACES: code, // to the line's end, block comments, '...' and "..." strings.
   State per character, so a symbol's position can be asked "am I inside a comment?". */
function scan(text) {
    const n = text.length, state = new Uint8Array(n)   // 0 code, 1 line comment, 2 block comment, 3 string
    let s = 0, q = ''
    for (let i = 0; i < n; i++) {
        const c = text[i], d = text[i + 1]
        if (s === 0) {
            if (c === '/' && d === '/') { s = 1 }
            else if (c === '/' && d === '*') { s = 2; state[i] = 2; state[i + 1] = 2; i++; continue }
            else if (c === '"' || c === "'") { s = 3; q = c }
        } else if (s === 1) { if (c === '\n') s = 0 }
        else if (s === 2) { if (c === '*' && d === '/') { state[i] = 2; state[i + 1] = 2; i++; s = 0; continue } }
        else if (s === 3) {
            if (c === '\\') { state[i] = 3; state[i + 1] = 3; i++; continue }
            if (c === q || c === '\n') { state[i] = 3; s = 0; continue }
        }
        state[i] = s
    }
    return state
}

const lineStarts = text => { const a = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') a.push(i + 1); return a }
const lineOf = (starts, pos) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= pos) lo = m; else hi = m - 1 } return lo }

/** Every position `sym` is found at, as character offsets. */
function find(text, starts, sym, fromLine = 0) {
    const m = matcher(sym), lines = text.split('\n'), out = []
    for (let i = fromLine; i < lines.length; i++) { const c = m.test(lines[i]); if (c >= 0) out.push(starts[i] + c) }
    return { hits: out, named: m.named }
}

/* THE COMMENT DIRECTLY ABOVE line `i` (0-based): contiguous lines that are // comments, or the block comment that
   closes on the line above. Blank lines end it. */
function docStart(lines, i) {
    let k = i
    const isLine = l => /^\s*\/\//.test(l)
    if (k > 0 && /\*\/\s*$/.test(lines[k - 1])) {
        while (k > 0 && !/\/\*/.test(lines[k - 1])) k--
        return Math.max(0, k - 1)
    }
    while (k > 0 && isLine(lines[k - 1])) k--
    return k
}

/** FNV-1a, 32 bits, over the lines with trailing spaces stripped and the common indent removed: the same in node and
 *  the browser, synchronous (crypto.subtle is only in secure contexts), and blind to re-indenting. */
export function hash(lines) {
    const t = normalise(lines).join('\n')
    let h = 0x811c9dc5
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
    return h.toString(16).padStart(8, '0')
}

/** The lines as shown: trailing spaces gone, the indent they share removed. */
export function normalise(lines) {
    const t = lines.map(l => l.replace(/\s+$/, ''))
    const ind = Math.min(...t.filter(l => l.trim()).map(l => /^ */.exec(l)[0].length))
    return t.map(l => l.slice(Number.isFinite(ind) ? ind : 0))
}

/**
 * Find `sym` in `text` and return the lines it covers.
 * @returns {{ first: number, last: number, lines: string[], hash: string }}  first and last 1-based, inclusive
 * @throws  Error naming why: not found, found more than once, an extent that does not close within `max`
 */
export function locate(text, { sym, nth, within, to, max = 40, doc } = {}) {
    if (!sym) throw new Error('no symbol given')
    const starts = lineStarts(text), lines = text.split('\n')
    let from = 0
    if (within) {
        const w = find(text, starts, within)
        if (w.hits.length !== 1) throw new Error(`"${within}" (within) found ${w.hits.length} times`)
        from = lineOf(starts, w.hits[0])
    }
    const { hits, named } = find(text, starts, sym, from)
    if (!hits.length) throw new Error(`"${sym}" not found`)
    let pos
    if (nth) {
        if (hits.length < nth) throw new Error(`"${sym}" found ${hits.length} times, not ${nth}`)
        pos = hits[nth - 1]
    } else if (within) pos = hits[0]
    else if (hits.length > 1) throw new Error(`"${sym}" found ${hits.length} times: say which (nth or within)`)
    else pos = hits[0]

    const startLine = lineOf(starts, pos)
    let endLine
    const state = scan(text)
    if (to) {
        endLine = -1
        for (let i = startLine; i < lines.length && i < startLine + max; i++) {
            if ((i === startLine ? lines[i].slice(pos - starts[i]) : lines[i]).includes(to)) { endLine = i; break }
        }
        if (endLine < 0) throw new Error(`"${to}" (to) not within ${max} lines of "${sym}"`)
    } else if (state[pos] === 2) {
        let i = pos
        while (i < text.length && state[i] === 2 && !(text[i] === '/' && text[i - 1] === '*')) i++
        endLine = lineOf(starts, i)
    } else if (named && /^(const|let|var)\b/.test(sym.trim()) && !/[{([=,+\-*/?:&|]\s*$/.test(lines[startLine]) && !lines[startLine].includes('{')) {
        endLine = startLine                     // `const f = (x) => x * 2` -- one line, and this repo writes no semicolons
    } else {
        let i = pos, depth = 0, open = false
        for (; i < text.length; i++) {
            if (state[i] !== 0) continue
            if (text[i] === '{') { depth++; open = true }
            else if (text[i] === '}') { depth--; if (open && depth === 0) break }
            if (!open && text[i] === ';') break          // a declaration with no body: `const X = 3;`
        }
        endLine = lineOf(starts, Math.min(i, text.length - 1))
    }
    const wantDoc = doc ?? named
    const first = wantDoc ? docStart(lines, startLine) : startLine
    if (endLine - first + 1 > max) throw new Error(`"${sym}" runs ${endLine - first + 1} lines, over max ${max}`)
    const out = lines.slice(first, endLine + 1)
    return { first: first + 1, last: endLine + 1, lines: out, hash: hash(out) }
}

/** The attributes a page writes on an excerpt, as locate's options. Shared by the page and the test. */
export function optionsOf(get) {
    const n = k => { const v = get(k); return v == null || v === '' ? undefined : +v }
    const s = k => { const v = get(k); return v == null || v === '' ? undefined : v }
    const d = get('data-doc')
    return { sym: s('data-sym'), nth: n('data-nth'), within: s('data-in'), to: s('data-to'), max: n('data-max'),
             doc: d == null ? undefined : d !== 'no' }
}

/** What language a file's excerpt is, for the label: the engine's kernels are WGSL inside .js files. */
export const languageOf = (src, lines, text = null, first = 0) =>
    /\.md$/.test(src) ? 'Markdown'
        : text && first && /\.m?js$/.test(src) ? (insideTemplate(text, first) ? 'WGSL' : 'JavaScript')
        : lines.some(l => /\bfn\s+\w+\s*\(|\bvar<|\bVEC[234]\b|\bu32\b|\bf32\b|let\s+\w+\s*:\s*\w/.test(l)) ? 'WGSL'
            : 'JavaScript'

/* Whether line `first` of a .js file lies inside a template literal: the engine's WGSL is written as one, so an excerpt
   in it is WGSL however much its lines look like JavaScript, and one outside it is JavaScript however much its comment
   talks of f32 (the guess by keywords, kept for when the file's text is not at hand, called shapes.js's header WGSL).
   A small scanner, not a count of backticks: a JavaScript comment can hold one backtick, and a template can hold
   ${...} with templates inside it. It knows code, comments, quoted strings and templates; a regular expression
   literal holding a quote would fool it, and none of the engine's files has one before its WGSL. */
function insideTemplate(text, first) {
    if (!text || !first) return false
    let end = 0
    for (let k = 1; k < first && end >= 0; k++) end = text.indexOf('\n', end) + 1
    const stack = []                                 // 'code' (with its brace depth) or 'tpl', innermost last
    let mode = 'code', depth = 0
    for (let i = 0; i < end; i++) {
        const c = text[i], d = text[i + 1]
        if (mode === 'tpl') {
            if (c === '\\') i++
            else if (c === '`') { mode = 'code'; ({ depth } = stack.pop() ?? { depth: 0 }) }
            else if (c === '$' && d === '{') { stack.push({ mode: 'tpl' }); mode = 'code'; depth = 0; i++ }
        } else if (c === '/' && d === '/') { const n = text.indexOf('\n', i); i = n < 0 ? end : n }
        else if (c === '/' && d === '*') { const n = text.indexOf('*/', i + 2); i = n < 0 ? end : n + 1 }
        else if (c === '"' || c === "'") { let k = i + 1; while (k < end && text[k] !== c && text[k] !== '\n') k += text[k] === '\\' ? 2 : 1; i = k }
        else if (c === '`') { stack.push({ mode: 'code', depth }); mode = 'tpl' }
        else if (c === '{') depth++
        else if (c === '}') { if (depth > 0) depth--; else if (stack.length && stack[stack.length - 1].mode === 'tpl') { stack.pop(); mode = 'tpl' } }
    }
    return mode === 'tpl'
}
