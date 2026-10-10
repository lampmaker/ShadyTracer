//======================================================================================================================
// Tests for the line mapper. Run: node builder/test/emit.test.mjs
//
// WHY THESE EXIST AT ALL: the previous scene builder shipped a compile-error line remapper
// that was fully written, wired up, and never once called, so nobody found out it did not
// work. The mapper is the feature -- a driver error is a line number in a file the user never
// wrote -- and it is pure data arithmetic, so there is no excuse for it to be unverified.
//
// No GPU, no DOM, no WebGPU: node runs this as-is.
//======================================================================================================================
import { Emit, resolve, mapMessages, formatMessages } from '../emit.js'
import { TOKENS, SHORT_TOKENS, shorthand } from '../../lib/wgsl_shorthand.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) =>
    ok(name, JSON.stringify(got) === JSON.stringify(want),
        `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)

//----------------------------------------------------------------------------------------------
// A generated file: prelude, one node, glue, another node.
//----------------------------------------------------------------------------------------------
const e = new Emit()
e.raw('// prelude line 1\n// prelude line 2')       // lines 1-2
e.from('sphere', 'let d = length(p) - r;')          // line 3
e.raw('// glue')                                    // line 4
e.from('blob', 'let a = 1.0;\nlet b = 2.0;\nlet c = a + b;')  // lines 5-7
e.raw('// tail')                                    // line 8
const map = e.map

eq('line count', e.wgsl.split('\n').length, 8)
eq('prelude is unmapped', resolve(map, 1), null)
eq('glue between spans is unmapped', resolve(map, 4), null)
eq('tail after the last span is unmapped', resolve(map, 8), null)
eq('single-line node', resolve(map, 3), { node: 'sphere', line: 1 })
eq('multi-line node, first', resolve(map, 5), { node: 'blob', line: 1 })
eq('multi-line node, last', resolve(map, 7), { node: 'blob', line: 3 })
eq('past the end', resolve(map, 99), null)
eq('before the start', resolve(map, 0), null)

//----------------------------------------------------------------------------------------------
// `origin`: emitting a slice of a longer snippet still blames the right line of it.
//----------------------------------------------------------------------------------------------
const sliced = new Emit()
sliced.raw('// header')
sliced.from('trimmed', 'line four\nline five', 4)
eq('origin offsets the reported line', resolve(sliced.map, 2), { node: 'trimmed', line: 4 })
eq('origin, second line', resolve(sliced.map, 3), { node: 'trimmed', line: 5 })

//----------------------------------------------------------------------------------------------
// Messages. A generator-owned error must SAY so rather than being blamed on a node.
//----------------------------------------------------------------------------------------------
const mapped = mapMessages(map, [
    { type: 'warning', message: 'unused variable', lineNum: 5, linePos: 5 },
    { type: 'error', message: "unresolved identifier 'r'", lineNum: 3, linePos: 20 },
    { type: 'info', message: 'noise nobody asked for', lineNum: 1, linePos: 1 },
    { type: 'error', message: 'generator wrote nonsense', lineNum: 4, linePos: 1 },
], e.wgsl)

eq('info is dropped', mapped.length, 3)
eq('errors sort before warnings', mapped.map(m => m.type), ['error', 'error', 'warning'])
eq('error is blamed on its node', [mapped[0].node, mapped[0].line], ['sphere', 1])
eq('generator error has no node', mapped[1].node, null)
eq('generator error keeps the generated line', mapped[1].generatedLine, 4)
eq('warning is blamed on its node', [mapped[2].node, mapped[2].line], ['blob', 1])
eq('the offending source line is quoted', mapped[0].text, 'let d = length(p) - r;')

const text = formatMessages(mapped)
ok('report names the node', text.includes('sphere:1'), text)
ok('report flags generator lines as not the user\'s', text.includes('generated line 4'), text)

//----------------------------------------------------------------------------------------------
// THE INVARIANT THE WHOLE MAPPING RESTS ON.
//
// tinywebgpu expands G.defines before the driver sees the source. The compiler therefore
// reports line numbers in the EXPANDED file, and every mapping here assumes that is the same
// file. It is, as long as no replacement contains a newline. Add a multi-line token and every
// error message in the builder points at the wrong line, silently -- so it is asserted, not
// assumed.
//----------------------------------------------------------------------------------------------
const all = { ...TOKENS, ...SHORT_TOKENS }
const multiline = Object.entries(all).filter(([, v]) => String(v).includes('\n')).map(([k]) => k)
eq('no shorthand token expands to more than one line', multiline, [])

const rw = shorthand(TOKENS, SHORT_TOKENS)
const before = 'fn f() -> VEC3 {\n  let a: VEC4 = VEC4(0.0);\n  return VEC3(1.0);\n}'
eq('expansion preserves the line count',
    rw(before).split('\n').length, before.split('\n').length)
ok('expansion actually rewrites', rw(before).includes('vec3<f32>'), rw(before))

//----------------------------------------------------------------------------------------------

{
    // a span that records a rename: the column a compiler reports is moved back to the one typed
    const e = new Emit().raw('fn f() {').from('g', 'a = children_g(b);\nc = 1;', 1, { 0: [{ at: 12, by: 2 }] }).raw('}')
    const [m] = mapMessages(e.map, [{ type: 'error', message: 'x', lineNum: 2, linePos: 16 }])
    eq('a column after the rename is the typed one', [m.node, m.line, m.col], ['g', 1, 14])
    const [n] = mapMessages(e.map, [{ type: 'error', message: 'x', lineNum: 3, linePos: 3 }])
    eq('the next line of the span has no shift', [n.line, n.col], [2, 3])
}

console.log(fail ? `\n${fail} failed, ${pass} passed.` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
