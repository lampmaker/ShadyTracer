//======================================================================================================================
// EMIT -- assemble generated WGSL while remembering where every line came from.
//
// THIS IS THE PIECE THE LAST ATTEMPT DIED WITHOUT, so it is the first one built.
//
// The previous scene builder (lampmaker/raytracer, scenebuilder/) emitted GLSL for an engine
// whose interface had moved on, so every scene it generated was a hard compile error. It had
// a compile-error line remapper -- written in full, wired up, and never once called. Nobody
// found out, because there was no loop: generate, compile, show the error. The generator and
// the engine drifted in silence for as long as the project lasted.
//
// So the loop comes first, and the half of it that can be tested WITHOUT A GPU is this file.
// A driver's error arrives as a line number in a file the user never wrote: a prelude of a
// few hundred lines of primitives and material helpers, then generated glue, then a snippet
// they typed. "Error on line 431" is useless. "Node `blob`, line 3" is the whole feature.
//
// PURE ON PURPOSE. Everything here is string and array arithmetic over data -- no device, no
// WGSL, no DOM -- because the container this was written in cannot run WebGPU at all, and
// because an untested remapper is exactly what failed last time. test/emit.test.mjs runs in
// node and covers it.
//
// THE INVARIANT IT ALL RESTS ON: tinywebgpu expands G.defines (VEC3 -> vec3<f32> and friends)
// before handing source to the driver, so the line numbers the compiler reports are numbers
// in the EXPANDED source. That is only the same file if no replacement contains a newline.
// Today none does, and the test asserts it -- add a multi-line token and every error message
// in the builder silently points at the wrong line.
//======================================================================================================================

/**
 * Accumulates lines and records which node each one came from.
 *
 * Two verbs, and the distinction is the point:
 *   raw(text)              generator-owned. An error here is MY bug, not the user's.
 *   from(node, text, at)   user-owned. An error here belongs to that node, at that line.
 */
export class Emit {
    constructor() {
        /** @type {string[]} */ this.lines = []
        /** @type {{line:number,count:number,node:string,origin:number}[]} */ this.spans = []
    }

    /** Generator-owned source: the prelude, the function headers, the glue. Not mapped. */
    raw(text) {
        for (const l of String(text).split('\n')) this.lines.push(l)
        return this
    }

    /**
     * Source the user wrote, mapped back to them.
     * @param node   the node id to blame
     * @param text   the snippet
     * @param origin the 1-based line of the snippet that `text` starts at, for when a caller
     *               emits a slice of a longer snippet rather than all of it
     * @param shifts where the text differs from what was typed, by line of `text` (0-based):
     *               { [line]: [{ at, by }] } -- `by` characters inserted at column `at` (0-based,
     *               in the emitted line). The one rewrite codegen makes, a group's `children(`
     *               becoming `children_<id>(`, keeps every line but moves the columns after it;
     *               this is how an error after it is still reported at the column typed.
     */
    from(node, text, origin = 1, shifts = null) {
        const body = String(text).split('\n')
        const span = { line: this.lines.length + 1, count: body.length, node, origin }
        if (shifts && Object.keys(shifts).length) span.shifts = shifts
        this.spans.push(span)
        for (const l of body) this.lines.push(l)
        return this
    }

    get wgsl() { return this.lines.join('\n') }
    /** Spans are emitted in order, so the lookup below can stop early. */
    get map() { return { spans: this.spans, lines: this.lines.length } }
}

/**
 * Which node owns a 1-based line of the generated file, and which of ITS lines it is.
 * Returns null for a line the generator owns -- prelude, glue, anything not `from()`.
 */
export function resolve(map, lineNum) {
    for (const s of map.spans) {
        if (lineNum < s.line) break                   // spans are ordered; past it already
        if (lineNum < s.line + s.count) {
            const at = { node: s.node, line: lineNum - s.line + s.origin }
            const shifts = s.shifts?.[lineNum - s.line]
            if (shifts) at.shifts = shifts
            return at
        }
    }
    return null
}

/**
 * Turn a GPUCompilationInfo's messages into something worth showing a person.
 *
 * Takes plain objects ({type, message, lineNum, linePos}) rather than the live
 * GPUCompilationInfo, so the mapping can be tested against a handful of literals instead of
 * against a GPU -- see the header.
 *
 * `source` is optional and only used to quote the offending line back. A generated line is
 * still worth quoting even when no node owns it: that is how a generator bug announces itself.
 */
export function mapMessages(map, messages, source = null) {
    const lines = source == null ? null : String(source).split('\n')
    return [...messages]
        .filter(m => m && m.type !== 'info' && m.message)
        .map(m => {
            const at = resolve(map, m.lineNum)
            return {
                type: m.type || 'error',
                message: String(m.message).trim(),
                node: at ? at.node : null,       // null = the generator's own output
                line: at ? at.line : m.lineNum,
                col: typedColumn(m.linePos || 0, at?.shifts),
                generatedLine: m.lineNum,
                text: lines && lines[m.lineNum - 1] !== undefined ? lines[m.lineNum - 1] : null,
            }
        })
        // errors before warnings: the first line of the report should be the thing that broke
        .sort((a, b) => (a.type === b.type ? a.generatedLine - b.generatedLine
            : a.type === 'error' ? -1 : 1))
}

/** A 1-based column of the emitted line as a column of the line typed: every insertion that
 *  ends before it is taken off, and a column inside an insertion is the insertion's start. */
export function typedColumn(col, shifts) {
    if (!shifts || !col) return col
    let out = col
    for (const { at, by } of shifts) {
        if (col - 1 >= at + by) out -= by
        else if (col - 1 >= at) out -= col - 1 - at
    }
    return out
}

/** One line per message, in the shape an editor gutter or a console both accept. */
export function formatMessages(mapped) {
    return mapped.map(m => {
        const where = m.node === null
            ? `generated line ${m.generatedLine}`   // says plainly that this one is not yours
            : `${m.node}:${m.line}`
        const src = m.text === null ? '' : `\n    ${m.text.trim()}`
        return `${m.type.toUpperCase()} ${where}:${m.col} — ${m.message}${src}`
    }).join('\n')
}
