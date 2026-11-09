// lib/pathtracer/savesize.js -- the size of a saved picture: its width, its height and whether they keep the view's aspect.
//
// Its own module so a check can drive it over the real property table (test/savesize.check.mjs): the rows are
// tweakpane's, and so were both of the bugs it was moved here for (0.79.0).
// - THE ROWS' STEP COUNTS FROM THEIR FIRST VALUE. Tweakpane's step snaps to multiples of 2 counted from the value
//   the row was bound with (tweakpane-4.0.4.js StepConstraint: its origin is the initial value). The rows were bound
//   with the view's size, and a window is as often odd as even: a view 721 high made every height odd, so 1000
//   typed became 1001. Hence evenSize before the rows are made, and on every size this writes.
// - A VALUE WRITTEN HERE COMES BACK AS A CHANGE. The page refreshes its tables a frame later (app.html `refresh`)
//   and the row reports the new value as a change, as if typed. With the aspect matched, fix() wrote the height
//   from the width; the height's echo ran fix('h'), which wrote the width from the height -- not the width typed,
//   off by the rounding -- whose echo wrote the height again: a size climbing a frame at a time, for ever. So a row's
//   change that only brings back what fix() last settled is not the user's, and moves nothing.

/** an even size, at least 16: what every encoder wants, and the step the rows snap to */
export const evenSize = v => Math.max(16, Math.round(v / 2) * 2)

/** The match-view switch and the width and height rows, in folder `f`, bound to `SV` (its `matchView`, `width`
 *  and `height`). `view()` is the view's [width, height]; `after()` runs once the sizes are settled (the note, the
 *  refresh). Returns `fix(lead)`, which keeps the two fields consistent (`lead` the one the user moved, 'w' or 'h'),
 *  and `useLive()`, the view's own size. */
export function addSaveSize(f, SV, { view, after = () => { } }) {
    const aspect = () => { const [w, h] = view(); return (w / h) || 1 }
    let kept = { w: NaN, h: NaN }          // the sizes fix() last settled: their rows' echo is not a change
    const fix = (lead = 'w') => {
        const ar = aspect()
        SV.width = evenSize(SV.width); SV.height = evenSize(SV.height)
        if (SV.matchView) {
            if (lead === 'h') SV.width = evenSize(SV.height * ar)
            else SV.height = evenSize(SV.width / ar)
        }
        kept = { w: SV.width, h: SV.height }
        after()
    }
    const useLive = () => { [SV.width, SV.height] = view(); fix() }
    // even BEFORE the rows are bound: their first value is the origin of their step
    SV.width = evenSize(view()[0]); SV.height = evenSize(view()[1])
    f.addBinding(SV, 'matchView', { label: 'match view aspect' }).on('change', () => fix())
    const wB = f.addBinding(SV, 'width', { min: 16, max: 16384, step: 2 })
    const hB = f.addBinding(SV, 'height', { min: 16, max: 16384, step: 2 })
    wB.on('change', () => { if (SV.width !== kept.w) fix('w') })
    hB.on('change', () => { if (SV.height !== kept.h) fix('h') })
    return { fix, useLive }
}
