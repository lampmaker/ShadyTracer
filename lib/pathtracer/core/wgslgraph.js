//======================================================================================================================
// WGSL CALL GRAPH -- how big a kernel is once every call in it is inlined, and how many copies of a given function
// that puts in it. For the static half of the benchmark (bench/shaderstats.mjs), and for the
// compile's progress bar (compileprogress.js): a kernel's inlined size predicts its compile time, its text does not.
// It lived in bench until the renderer needed it; that path re-exports this one.
//
// WHY INLINED SIZE AND NOT THE TEXT. Tint keeps functions as functions, but what it hands on is inlined: FXC
// inlines every call, and the GPU drivers' compilers inline nearly everything. So a function called from four
// places is compiled four times, and a kernel's text says little about what the compiler is given: the shade
// kernel is under twice the march's text and four to eleven times its inlined size (the bundled scenes,
// 2026-10-01). The count of SDF copies is the scene's share of that.
//
// WHAT IT IS NOT: a compiler. It finds `fn name(...) {...}`, and in each body every identifier followed by `(`
// that names one of them. Static call sites, not what a compiler keeps: a call in a branch a constant argument
// makes dead (getMaterial2(C, true) skipping localPoint) is counted, so a copy count is an upper bound.
// Recursion cannot occur (WGSL forbids it), so the graph is a DAG and memoised.
//======================================================================================================================

/** WGSL without comments; block comments nest in WGSL. Newlines are kept. */
export function stripComments(src) {
    let out = '', i = 0, depth = 0
    while (i < src.length) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; i += 2; continue }
        if (depth > 0 && src[i] === '*' && src[i + 1] === '/') { depth--; i += 2; continue }
        if (depth > 0) { if (src[i] === '\n') out += '\n'; i++; continue }
        if (src[i] === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
        out += src[i++]
    }
    return out
}
const squash = s => s.replace(/\s+/g, ' ').trim()

/** name -> { name, size (whitespace-collapsed characters of the whole fn), calls: [callee per call site] } */
export function functionsOf(src) {
    const code = stripComments(src)
    const fns = new Map()
    const re = /\bfn\s+([A-Za-z_]\w*)\s*\(/g
    let m
    while ((m = re.exec(code))) {
        let i = m.index + m[0].length, paren = 1
        while (i < code.length && paren > 0) { if (code[i] === '(') paren++; else if (code[i] === ')') paren--; i++ }
        while (i < code.length && code[i] !== '{') i++
        const start = i
        for (let depth = 0; i < code.length; i++) {
            if (code[i] === '{') depth++
            else if (code[i] === '}' && --depth === 0) break
        }
        fns.set(m[1], { name: m[1], body: code.slice(start, i + 1), size: squash(code.slice(m.index, i + 1)).length })
        re.lastIndex = i + 1
    }
    for (const f of fns.values()) {
        f.calls = []
        const cre = /\b([A-Za-z_]\w*)\s*\(/g
        let c
        while ((c = cre.exec(f.body))) if (fns.has(c[1]) && c[1] !== f.name) f.calls.push(c[1])
    }
    return fns
}

/**
 * `entry` with every call inlined: { text, inlined, copies: { target: n }, one: { target: inlined size of one } },
 * sizes in whitespace-collapsed characters of comment-free WGSL. null when there is no `entry`.
 */
export function inlineStats(src, entry = 'main', targets = ['SDF', 'getMaterial2']) {
    const fns = functionsOf(src)
    if (!fns.has(entry)) return null
    const memo = new Map()
    const visit = name => {
        if (memo.has(name)) return memo.get(name)
        const f = fns.get(name)
        const r = { size: f.size, copies: Object.fromEntries(targets.map(t => [t, 0])) }
        for (const c of f.calls) {
            const sub = visit(c)
            r.size += sub.size
            for (const t of targets) r.copies[t] += sub.copies[t] + (c === t ? 1 : 0)
        }
        memo.set(name, r)
        return r
    }
    const r = visit(entry)
    return {
        text: squash(stripComments(src)).length,
        inlined: r.size,
        copies: r.copies,
        one: Object.fromEntries(targets.map(t => [t, fns.has(t) ? visit(t).size : 0])),
    }
}
