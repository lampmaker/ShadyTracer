bump: patch

**Help › Reference › Functions for code lists every function a code block can call.** An object's, a group's or a
material's code, and the scene's functions, are all compiled after the same library, and nothing listed what is in
it. The new page has each function's signature and what it does: putting a shape into the scene (`add_new`, `fold`,
`warp`, `foldRelief`), the joins (`csgUnion` and the older ones, with why `csgUnion` is the one to use), the shapes
with an exact normal (`Nsphere`, `NboxRounded`, `Nlens`, ...) and those with a distance only (`sd...`), the 2D pieces
the shapes of revolution are built from, noise, units, the material helpers, and what a scene with an outline or a
path makes for it (`extrude`, `revolve`, `tube`, `sweep`). Each says which built-in shapes and modifiers use it, and
whether it is exact or a bound where its code says. The page also has what each kind of block has in scope, and the
words the page rewrites before compiling, so a variable called `X` (which becomes `vec4<f32>`) is no longer a
mystery. The comments a new block starts with point to it, and every code box in Properties has a **Functions you
can call…** button under *Apply code* that opens Help at the page: at the material helpers for a material's code, at
the noise for a relief's, at the top for the rest.

Each function is a card of its own in the Help panel: its signature on a line of its own, the name in gold and the
types in green, what it does under it, and what uses it quieter still (`help/markdown.js`: a list item of a code span
and ` -- ` words; on GitHub the page is still a list).

The signatures are read from the shader library itself (`help/reference.mjs`), so the page cannot disagree with the
code, and `help/test/coverage.test.mjs` fails on a function the page names that the library no longer has, and on a
shape or join added to the library without words.

**What to look at:** Help (F1) › Reference › *Functions for code*: the page reads, its links work (to *Parameters and
code*, the Shapes and Modifiers pages, and the WGSL standard's list of built-ins). A new code node, group code,
material code and the scene's functions each start with a comment line naming the page. In each of those code boxes,
and a relief's, **Functions you can call…** opens the Help panel at the page, a material's at *Materials* and a
relief's at *Noise*, the Help panel opened (floating) if it was closed. Scrolling the page, each function should be
easy to pick out: a card, its name in gold.
