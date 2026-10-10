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
    let lastKey = null, lastAt = -Infinity

    return {
        /** The document changed; `text` is its new state. Returns whether a step was recorded. */
        commit(text, key = null) {
            if (text === current) return false
            const t = now()
            const merge = key != null && key === lastKey && t - lastAt <= window && past.length > 0
            if (!merge) {
                past.push(current)
                if (past.length > limit) past.shift()
            }
            current = text
            future.length = 0              // a new edit ends the redo branch, as everywhere
            lastKey = key; lastAt = t
            return true
        },
        /** The text to restore, or null when there is nothing to undo. */
        undo() {
            if (!past.length) return null
            future.push(current)
            current = past.pop()
            lastKey = null                 // the next edit starts a new step, whatever its key
            return current
        },
        redo() {
            if (!future.length) return null
            past.push(current)
            current = future.pop()
            lastKey = null
            return current
        },
        /** Forget everything and start from `text` -- for a document that replaces this one
         *  outright and should not be undone into, if the owner wants that. */
        reset(text) { current = text; past.length = 0; future.length = 0; lastKey = null },
        get canUndo() { return past.length > 0 },
        get canRedo() { return future.length > 0 },
        get depth() { return { undo: past.length, redo: future.length } },
    }
}
