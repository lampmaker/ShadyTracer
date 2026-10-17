//======================================================================================================================
// HISTORY -- undo and redo for the builder's document, as JSON snapshots.
//
// SNAPSHOTS, NOT COMMANDS. A command history needs an inverse for every edit, and the edits here
// come from four places (model operations, bindings that write the document directly, the code
// editor, a load) -- an inverse missing from any of them is an undo that silently does the wrong
// thing. A document is a few kilobytes of JSON, so a hundred whole copies cost less than one
// texture, and restoring one is exactly as correct as loading a file.
//
// COMMIT AFTER, AND ONLY WHAT CHANGED. The owner calls commit() after an edit has happened. The
// history holds the text of the current state; a commit whose text is identical records nothing,
// so a handler that fires without changing anything (a dropdown set to its own value) costs no
// undo step, and calling commit() "too often" is harmless.
//
// COALESCED BY KEY. Dragging a slider is sixty edits a second; typing is one per key. A commit
// carrying the same key as the previous one, within `window` milliseconds, replaces that step
// instead of adding one -- so a drag or a burst of typing is a single undo, and a pause starts
// the next. A commit with no key never coalesces.
//
// WHAT A STEP WAS, beside its text (0.63.0): commit(text, key, meta) keeps `meta` with the step it records, and
// `step` is the meta of the step an undo or redo just went across -- so the owner can tell a change to the list of
// scenes from an edit inside one (builder/demo.js restore: the first stays on the scene being worked on, the user,
// 2026-10-17: "undo stays put"). The text alone cannot say which scene a step was about: a snapshot is the whole
// project. A merged step keeps the meta of its first commit.
//
// PURE: text in, text out, a clock that can be passed in. test/history.test.mjs runs it in node.
//======================================================================================================================

/**
 * @param initial  the document's text now -- the state an undo can return to first
 * @param limit    how many undo steps to keep; the oldest go first
 * @param window   ms within which same-key commits merge
 * @param now      the clock, injectable for tests
 */
export function createHistory(initial, { limit = 100, window = 800, now = () => Date.now() } = {}) {
    let current = initial
    const past = [], future = []
    // each state's meta: that of the step that made it (null for the first, and for a commit given none)
    let currentMeta = null, step = null
    const pastMeta = [], futureMeta = []
    let lastKey = null, lastAt = -Infinity

    return {
        /** The document changed; `text` is its new state, `meta` what the step was (kept beside it, given back
         *  as `step` when it is undone or redone). Returns whether a step was recorded. */
        commit(text, key = null, meta = null) {
            if (text === current) return false
            const t = now()
            const merge = key != null && key === lastKey && t - lastAt <= window && past.length > 0
            if (!merge) {
                past.push(current); pastMeta.push(currentMeta)
                if (past.length > limit) { past.shift(); pastMeta.shift() }
                currentMeta = meta
            } else currentMeta ??= meta
            current = text
            future.length = 0; futureMeta.length = 0      // a new edit ends the redo branch, as everywhere
            lastKey = key; lastAt = t
            return true
        },
        /** The text to restore, or null when there is nothing to undo. */
        undo() {
            if (!past.length) return null
            step = currentMeta             // the step being undone is the one that made the state left
            future.push(current); futureMeta.push(currentMeta)
            current = past.pop(); currentMeta = pastMeta.pop()
            lastKey = null                 // the next edit starts a new step, whatever its key
            return current
        },
        redo() {
            if (!future.length) return null
            past.push(current); pastMeta.push(currentMeta)
            current = future.pop(); currentMeta = futureMeta.pop()
            step = currentMeta             // the step redone is the one that made the state reached
            lastKey = null
            return current
        },
        /** The meta of the step the last undo or redo went across (null if it had none). */
        get step() { return step },
        /** Forget everything and start from `text` -- for a document that replaces this one
         *  outright and should not be undone into, if the owner wants that. */
        reset(text) { current = text; past.length = 0; future.length = 0; pastMeta.length = 0; futureMeta.length = 0; currentMeta = step = null; lastKey = null },
        get canUndo() { return past.length > 0 },
        get canRedo() { return future.length > 0 },
        get depth() { return { undo: past.length, redo: future.length } },
    }
}
