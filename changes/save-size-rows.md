bump: patch

**The Save an image box's width and height stay as typed.** With "match view aspect" on, typing a width set both
sizes climbing a couple of pixels a frame, for ever: each size the box wrote came back from its row a frame later as
if typed, and the width worked out from the height was off by the rounding from the width typed. A row's echo of what
the box last settled is no longer taken for a change. With it off, a height of 1000 became 1001 when the view was an
odd number of pixels high: the rows snap to steps of 2 counted from the value they were made with, which was the view's
own size; they now start even. The rows live in `lib/pathtracer/savesize.js`, driven over the real property table by
`lib/pathtracer/test/savesize.check.mjs`.

**What to look at:** Render › Save an image. With "match view aspect" on, type a width: the height follows once and
both stay put. Turn it off and type 1000 × 1000: it stays 1000 × 1000. "Use the live size" with an odd-sized window
gives the even size next to it.
