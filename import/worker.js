//======================================================================================================================
// THE IMPORT, OFF THE PAGE'S THREAD: a STEP or STL file converted (index.js convert) in a module Worker, so a part
// that takes seconds -- the boss fixture's STL is two in Node, fitting its tori; the user's 121-face Onshape part was 29
// (2026-11-04) -- does not stop the picture, and the import dialog (builder/importdialog.js) can show how far it is.
//
//   postMessage({ name, bytes (ArrayBuffer, transferred), material, options })
//   -> { progress: { label, fraction, part, parts } }   as it goes, at most one each PROGRESS_MS (throttle below)
//   -> { ok: true, kind, asset, parts: [{ name, id, report }], refused, warnings } | { ok: false, error }   once, at the end
// The parts' formulas and shapes stay here: they hold functions, and the page needs the asset and the counts.
//======================================================================================================================
import * as Model from '../builder/model.js'
import { convert } from './index.js'
import { throttle, resultMessage } from './progress.js'

self.onmessage = e => {
    const { name, bytes, material, options = {} } = e.data
    const post = throttle(p => self.postMessage({ progress: p }))
    try {
        const r = convert(Model, name, new Uint8Array(bytes), { ...options, material, onProgress: post })
        post.flush()
        self.postMessage(resultMessage(r))
    } catch (err) {
        self.postMessage({ ok: false, error: err?.message || String(err) })
    }
}
