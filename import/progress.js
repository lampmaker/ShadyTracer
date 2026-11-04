//======================================================================================================================
// THE IMPORT'S PROGRESS, between the worker and the page: what goes over postMessage, and how often. Pure, so the
// worker (worker.js), the page's no-worker fallback (app.html convertCAD) and the tests (import/test/progress.test.mjs)
// share it.
//
// A message a stage of csg.js would be thousands a second (it reports every 256 points); a structured clone each and
// a dialog redrawn each is work the page does not need -- the bar moves a pixel at most. So at most one each
// PROGRESS_MS, the latest kept: a stage that ends between two still shows as ended, as the last one is always sent
// (flush), and the very first is sent at once so the dialog has words before the slow first stage.
//======================================================================================================================

export const PROGRESS_MS = 100

/** fn wrapped to be called at most once each `ms` with the latest value; `.flush()` sends one still held. `now` is the
 *  clock (a test's own). */
export function throttle(fn, ms = PROGRESS_MS, now = () => Date.now()) {
    let last = -Infinity, held = null
    const f = p => {
        const t = now()
        if (t - last >= ms) { last = t; held = null; fn(p) } else held = p
    }
    f.flush = () => { if (held) { const p = held; held = null; last = now(); fn(p) } }
    return f
}

/** What the page is sent of a conversion (index.js convert's result): the asset, each part's name, group id and report,
 *  what was refused and why, the warnings. The formulas and shapes stay behind: they hold functions. */
export const resultMessage = r => ({
    ok: true, kind: r.kind, asset: r.asset, parts: r.parts.map(p => ({ name: p.name, id: p.id, report: p.report })),
    refused: r.refused, warnings: r.warnings,
})
