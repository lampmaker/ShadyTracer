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
mystery. The comments a new block starts with point to it.

The signatures are read from the shader library itself (`help/reference.mjs`), so the page cannot disagree with the
code, and `help/test/coverage.test.mjs` fails on a function the page names that the library no longer has, and on a
shape or join added to the library without words.

**What to look at:** Help (F1) › Reference › *Functions for code*: the page reads, its links work (to *Parameters and
code*, the Shapes and Modifiers pages, and the WGSL standard's list of built-ins). A new code node, group code,
material code and the scene's functions each start with a comment line naming the page.
