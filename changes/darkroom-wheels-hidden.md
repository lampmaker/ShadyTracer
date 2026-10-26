bump: patch

**The page started whole again: the Darkroom's colour wheels no longer throw when made out of sight.** The page makes the
wheels at its start, in a Darkroom not yet shown, where a disc is 0 wide; its radius came out negative and `arc()`
threw (`IndexSizeError: The radius provided (-1.5) is negative`). The throw ended `installUI` there, so the Darkroom's
boxes after the wheels (Grading, the recipe and presets) and everything after it (the Developer switch, the boxes' visibility, the Tests menu) were
never made. A disc with no room is now not drawn until it has a size, which its ResizeObserver already waited for.
`darkroomtools.check.mjs` makes the curves editor and the wheels in a host not shown, and draws them once shown.

**What to look at:** no error in the console at the start; the Tests menu, the Developer switch and the Darkroom's
Grading box there; the colour wheels drawn when the Darkroom is first opened.
