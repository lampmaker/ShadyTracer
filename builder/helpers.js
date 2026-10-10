//======================================================================================================================
// THE SCENE'S HELPERS, ONE BY ONE -- what an asset carries of the functions block (model.js extractAsset; PERFORMANCE.md
// P3, call 7: "a block's use of a helper is found by its name in the code, and the helper goes with the block into the
// library"). The functions block (doc.functions) is WGSL every code node, group and material of the scene may call. A
// library item used to carry its blocks and materials but none of it, so a lens whose code called `lensSag(...)` went
// into another scene without `lensSag`: a compile error there, or -- worse -- that scene's own `lensSag`, which is
// another shape.
//
// WHAT IS AN ITEM: each top-level declaration of the block -- `fn`, `struct`, `const`, `alias`, `var`, `override` --
// with the comment lines right above it, which say what it is. What an asset needs is every item whose name its code
// reads, and every item those read, in the order the block has them (WGSL does not care; the reader does).
//
// A NAME READ is the name as a whole word outside comments: `lensSag(` and `LENS_N` alike. A word that only looks like
// one -- a parameter of the same name -- carries an item the code does not need, which costs nothing but text.
//
// PURE: no DOM, no device. test/helpers.test.mjs.
//======================================================================================================================

const KEYWORDS = ['fn', 'struct', 'const', 'alias', 'var', 'override']
const ident = /[A-Za-z_][A-Za-z0-9_]*/y

/* the index just past the comment starting at i (`//` to the line's end, or a block comment, nested as WGSL nests
   them), or i when none starts there */
function pastComment(src, i) {
    if (src.startsWith('//', i)) { const nl = src.indexOf('\n', i); return nl < 0 ? src.length : nl }
    if (!src.startsWith('/*', i)) return i
    let depth = 0
    while (i < src.length) {
        if (src.startsWith('/*', i)) { depth++; i += 2 }
        else if (src.startsWith('*/', i)) { depth--; i += 2; if (!depth) return i }
        else i++
    }
    return src.length
}

/** The text without its comments, each replaced by a space: what a name is looked for in. */
export function withoutComments(text) {
    const src = String(text ?? '')
    let out = '', i = 0
    while (i < src.length) {
        const j = pastComment(src, i)
        if (j !== i) { out += ' '; i = j; continue }
        out += src[i++]
    }
    return out
}

/**
 * The top-level items of a functions block: [{ kind, name, text }], in order, each `text` the declaration with the
 * comment lines right above it. What is not an item (a stray statement) is left out; WGSL would refuse it anyway.
 */
export function helpersOf(text) {
    const src = String(text ?? ''), out = []
    let i = 0, braces = 0, lastEnd = 0
    while (i < src.length) {
        const j = pastComment(src, i)
        if (j !== i) { i = j; continue }
        const c = src[i]
        if (c === '{') { braces++; i++; continue }
        if (c === '}') { braces = Math.max(0, braces - 1); i++; continue }
        if (braces || !/[A-Za-z_]/.test(c) || (i > 0 && /[A-Za-z0-9_]/.test(src[i - 1]))) { i++; continue }
        ident.lastIndex = i
        const word = ident.exec(src)[0]
        if (!KEYWORDS.includes(word)) { i += word.length; continue }
        // its name: the next identifier, past a var's <address space>
        let k = i + word.length
        while (k < src.length && /\s/.test(src[k])) k++
        if (word === 'var' && src[k] === '<') { k = src.indexOf('>', k) + 1; while (k < src.length && /\s/.test(src[k])) k++ }
        ident.lastIndex = k
        const name = ident.exec(src)?.[0]
        if (!name || ident.lastIndex !== k + name.length) { i = k; continue }
        // its end: a fn's or a struct's closing brace (and a ; after it), anything else's ;
        let e = k + name.length, depth = 0, opened = false
        const block = word === 'fn' || word === 'struct'
        while (e < src.length) {
            const p = pastComment(src, e)
            if (p !== e) { e = p; continue }
            const ch = src[e]
            if (ch === '{') { depth++; opened = true }
            else if (ch === '}') { depth--; if (block && opened && depth === 0) { e++; break } }
            else if (ch === ';' && depth === 0 && !block) { e++; break }
            e++
        }
        if (block) { let s = e; while (s < src.length && /[ \t]/.test(src[s])) s++; if (src[s] === ';') e = s + 1 }
        // the comment lines right above it, back to the item before
        let start = i
        const lines = src.slice(lastEnd, i).split('\n')
        let take = 0
        for (let l = lines.length - 2; l >= 0; l--) {
            const t = lines[l].trim()
            if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.endsWith('*/')) take++
            else break
        }
        if (take) start = i - lines.slice(lines.length - 1 - take).join('\n').length
        out.push({ kind: word, name, text: src.slice(start, e).replace(/^\s*\n/, '') })
        lastEnd = e
        i = e
    }
    return out
}

/* the names among `names` that `code` reads as whole words */
const readsOf = (code, names) => {
    const src = withoutComments(code)
    return names.filter(n => new RegExp(`(^|[^A-Za-z0-9_])${n}(?![A-Za-z0-9_])`).test(src))
}

/**
 * WHAT A PIECE OF THE SCENE NEEDS OF ITS FUNCTIONS BLOCK: every item `codes` (strings: its blocks', its materials',
 * their reliefs') read, and every item those read, as the block has them -- the text an asset carries.
 */
export function helpersFor(functions, codes) {
    const items = helpersOf(functions), names = items.map(x => x.name)
    const need = new Set(codes.flatMap(c => readsOf(c, names)))
    for (let grew = true; grew;) {
        grew = false
        for (const x of items) if (need.has(x.name)) for (const n of readsOf(x.text, names)) if (!need.has(n)) { need.add(n); grew = true }
    }
    return items.filter(x => need.has(x.name)).map(x => x.text).join('\n\n')
}

/** Two items the same: the same text, whitespace and comments aside. */
export const sameHelper = (a, b) => withoutComments(a).replace(/\s+/g, ' ').trim() === withoutComments(b).replace(/\s+/g, ' ').trim()
