//======================================================================================================================
// THE IMPORT, OFF THE PAGE'S THREAD: a STEP or STL file converted (index.js convert) in a module Worker, so a part
// that takes seconds -- the boss fixture's STL is two in Node, fitting its tori -- does not stop the picture.
//
//   postMessage({ name, bytes (ArrayBuffer, transferred), material })
//   -> { ok: true, kind, asset, parts: [{ name, report }], refused, warnings } | { ok: false, error }
// The parts' formulas and shapes stay here: they hold functions, and the page needs the asset and the counts.
//======================================================================================================================
import * as Model from '../builder/model.js'
import { convert } from './index.js'

self.onmessage = e => {
    const { name, bytes, material } = e.data
    try {
        const r = convert(Model, name, new Uint8Array(bytes), { material })
        self.postMessage({ ok: true, kind: r.kind, asset: r.asset, parts: r.parts.map(p => ({ name: p.name, report: p.report })),
                           refused: r.refused, warnings: r.warnings })
    } catch (err) {
        self.postMessage({ ok: false, error: err?.message || String(err) })
    }
}
