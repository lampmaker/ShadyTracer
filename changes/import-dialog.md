bump: minor

**Importing a STEP or STL file shows its progress in a dialog, and when something does not convert cleanly the dialog
asks before anything is pasted.** File › Import from file… (or a dropped file) opens a box over the view with the
file's name, what the conversion is doing (classifying points, building the formula, checking it -- each part of an
assembly in turn) and a bar, with Cancel, which stops the conversion. The same bar is in the status bar. A part that
converts cleanly is pasted at once and the box closes, as before. Otherwise it stays and says, part by part, what
happened: the shapes it became, how many of the conversion's check points disagree with the solid (small errors there:
a notch or a bump near an edge, which used to be reported nowhere), and why a part was refused. Each part of an
assembly has a box to leave it out, and **Import what converted** pastes the rest. The conversion reports its stages
(import/csg.js `onProgress`, import/index.js `convert`); the worker sends them at most ten a second
(import/progress.js); the dialog is builder/importdialog.js.

**What to look at:** import a part that takes a few seconds (your Onshape part from 2026-11-04 takes about half a
minute): the bar should move through its stages and the status bar's with it, and Cancel should stop it with nothing
pasted. That part has 6 points that disagree, so the box should stay open and say so; Import pastes it as before.
Import an assembly and untick one part: only the other should be pasted.
