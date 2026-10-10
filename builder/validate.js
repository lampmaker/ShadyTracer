//======================================================================================================================
// VALIDATE -- compile a generated scene and say which node broke it.
//
// The other half of the loop the last attempt never closed. emit.js knows which generated line
// belongs to which node; this puts a real WGSL compiler in front of it and hands the answer
// back in those terms.
//
// A PROBE, NOT THE REAL SCENE. setScene() rebuilds three kernels that inline the scene, and at
// any depth worth editing that is seconds of compiling -- far too slow to sit in an editor's
// keystroke loop. The probe is one small compute shader over the SAME prelude and the SAME
// uniform struct (computeUniformTypes, exactly what prog_march is given), with a body that does
// nothing but call SDF. Same declarations, same names, same shorthand expansion: if the probe
// is valid WGSL, the kernels' scene code is. Only then is setScene worth paying for.
//
// A MODULE, NOT A PIPELINE (0.9.5). The probe used to be made as a pipeline and awaited: the
// browser's front end checked it in tens of milliseconds, then the driver compiled it for
// seconds -- recorded at 1.2-3.1 s before every structural edit (PERFORMANCE.md, a structural
// edit end to end), and again on every pause in the code editor's typing. Every message this
// file reports came from the module's compilation info even then: the pipeline added only the
// driver's own refusals. So the probe is now the module alone (makeCompute's moduleOnly), and a
// kernel the driver still refuses is reported by setScene, as it always could be (demo.js
// applyNow: "a kernel the probe passed was refused"). Measured on the user's Pascal card: a
// march kernel's text checked as a module in 27-33 ms (the benchmark's moduleMs, 2026-10-02).
//
// "The same prelude" is codegen.js's job and this paragraph used to be the only place it was
// written down -- which is how the first run came back `unresolved type 'Hit'` from a line
// inside SCENE_COMMON: the body arriving here was the scene without DEFINITIONS in front of
// it. A comment asserting an invariant that nothing checks is not an invariant. The test now
// compares the generated body against the real SCENE_PRELUDE pieces (core/scene_api.js).
//
// WHY IT STILL GOES THROUGH makeCompute RATHER THAN createShaderModule. The generated SDF reads
// UB.whatever, so the probe needs the uniform struct, and building that by hand here would be a
// second implementation of something tinywebgpu already does -- the exact mistake the last
// scene builder made with sdfResult, where the generator's idea of the engine's interface and
// the engine's actual interface drifted apart in silence. Let the toolkit emit the struct.
//
// THE LINE OFFSET IS MEASURED, NOT ASSUMED. makeCompute prepends its generated schema (the UB
// struct, the bindings) to the body, so the compiler's line numbers are further down the file
// than the map thinks. Rather than counting the schema's lines -- which would be a constant
// that rots the first time the toolkit changes -- the offset is found by locating the body
// inside the final source. Exact, and it cannot go stale.
//======================================================================================================================

import { mapMessages, formatMessages } from './emit.js'

/** A body that forces the compiler to look at SDF. Without a caller it is dead code and a
 *  broken SDF can compile clean -- which would make this whole file a decoration. Exported for
 *  check-shaders, which builds this same probe for every builder scene. */
export const PROBE_MAIN = /*wgsl*/`
    // Never dispatched. It exists so SDF, getMaterial2 and everything they reach are
    // reachable from an entry point and therefore actually type-checked.
    if (gid.x > 0u) { return; }
    var r: Ray = newRay(VEC3(0.0, 0.0, 1.0), VEC3(0.0, 0.0, -1.0), VEC4(1.0), 1.0);
    let h = SDF(r);
    probe[0] = h.s.w + f32(h.m) + f32(h.a);
`

/**
 * Compile a generated scene body and return what is wrong with it, in the user's terms.
 *
 * @param gpu           an initialised tinywebgpu instance
 * @param body          the full WGSL body: prelude + generated scene (Emit#wgsl)
 * @param map           the matching Emit#map
 * @param uniformTypes  computeUniformTypes(scene.uniforms) -- the real kernel's uniform surface
 * @param resources     scene.resources -- what the scene reads besides its uniforms: the scene as data's buffer
 *                      (builder/scenedata.js). Declared as every kernel declares it; without it the probe of a data
 *                      scene failed on a name the kernels have (check-shaders' naga pass, the first time it ran)
 * @returns { ok, messages, report, wgsl, offset }
 */
export async function validate(gpu, body, map, uniformTypes = {}, resources = {}) {
    let final = body, module
    try {
        ({ wgsl: final, module } = gpu.makeCompute(body, PROBE_MAIN, uniformTypes,
            { probe: 'array<f32>', ...resources }, { wg: [1, 1, 1], moduleOnly: true }))
    } catch (e) {
        return { ok: false, messages: [], wgsl: final, offset: null, report: `the probe could not be made: ${e?.message ?? e}` }
    }
    const offset = lineOffsetOf(body, final)
    const messages = await compilationMessages(module)
    /* NO ANSWER IS NOT A CLEAN ANSWER: without the compiler's messages (a lost device) nothing says the scene
       is valid, and a probe that said ok here would send it to seconds of setScene on a guess. */
    if (messages === null) return { ok: false, messages: [], wgsl: final, offset, report: 'the compiler gave no answer (device lost?)' }
    const failed = messages.some(m => m.type === 'error')
    if (offset === null) return unmapped(final, failed ? messages.map(m => `line ${m.lineNum}: ${m.message}`).join('\n')
        : 'it compiled clean, so nothing is lost but the warnings', !failed)
    // Warnings are worth surfacing too -- an unused uniform in a generated scene usually means a
    // node emitted a declaration and then nothing that reads it.
    return finish(map, messages, final, offset)
}

/** The body could not be located in what was compiled, so no line can be attributed to a node.
 *  Says so, with the driver's raw lines, instead of mapping everything to the wrong place. */
const unmapped = (final, detail, ok = false) => ({
    ok, messages: [], wgsl: final, offset: null,
    report: `cannot map compiler lines to nodes: the probe body's first line was not found `
        + `exactly once in the compiled source (was BODY_MARKER removed?)\n${detail}`,
})

export const finish = (map, messages, final, offset) => {
    const shifted = { ...map, spans: map.spans.map(s => ({ ...s, line: s.line + offset })) }
    const mapped = mapMessages(shifted, messages, final)
    return {
        ok: !mapped.some(m => m.type === 'error'),
        messages: mapped, report: formatMessages(mapped), wgsl: final, offset,
    }
}

/** The line every probe body starts with. It has to be NON-BLANK and UNIQUE, and both
 *  properties were missing before it existed: the body began with SCENE_PRELUDE, whose first
 *  line is empty, so searching for it matched at offset 0 and every error was mapped as if
 *  tinywebgpu had prepended nothing. And makeCompute trims its source, which stripped those
 *  blank lines too -- two more lines of drift. A marker survives the trim and cannot be
 *  confused with anything else in the file. */
export const BODY_MARKER = '// ---- scene builder: probe body starts on this line ----'

/** Where `body` starts inside `final`, as a 0-based line count to add to every span, or null
 *  when it cannot be found. Measured rather than assumed, by exact line match on the body's
 *  first line -- which must be BODY_MARKER. Null is reported, never guessed around: mapping
 *  every error one screen off is worse than saying the mapping is unavailable. */
export function lineOffsetOf(body, final) {
    const head = String(body).split('\n')[0]
    if (!head.trim()) return null                       // a blank line matches anywhere
    const lines = String(final).split('\n')
    const at = lines.indexOf(head)
    if (at < 0 || lines.indexOf(head, at + 1) >= 0) return null   // missing, or ambiguous
    return at
}

/** The module's structured messages, which tinywebgpu logs to the console but does not hand back;
 *  null when they cannot be had. */
async function compilationMessages(module) {
    try {
        const info = await module.getCompilationInfo()
        return [...info.messages].map(m => ({
            type: m.type, message: m.message, lineNum: m.lineNum, linePos: m.linePos,
        }))
    } catch { return null }
}
