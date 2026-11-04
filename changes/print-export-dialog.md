bump: minor

**3D print export asks what to print, and adds nothing to the scene.** File › Export ▸ 3D print (3MF / STL)… opens a
dialog. Choose **Selected object** or **Whole scene**:
- **Selected object** prints that object alone: an object, or a group and everything in it, with nothing of its
  neighbours. It is printed in its own frame, so its z is up on the bed.
- **Whole scene** prints everything solid in the world's frame, as before.

**How the box works.**
- The box starts fitted to what you chose, from the measured boxes. For the whole scene, lights and an endless floor
  are left out.
- The box is drawn dashed in the picture while the dialog is open.
- Type another size to cut it, or press **Fit** to fit it again.
- The cell, the colour count and the format are remembered in this browser for the next export.

**The export box is gone.** It was a node in the tree, added from **+** only so that its Properties could hold the
buttons, and it stayed in the scene afterwards. It is no longer in the **+** menu. A file that has one opens without it.
The scene format is now version 27, and an older build refuses a file of 27.

**How "Selected object" works.** The export makes a scene of that object alone and compiles a field kernel for it
(seconds, once per object), keeping every frame between the object and the world. What the groups above it *do* is
left out: their joins, blends and modifiers, and an array's other copies. A part subtracted from another is printed as
itself.

`builder/printdialog.js`, `builder/exportbox.js` (`fittedBox`, `subjectTree`), `RT.sampleField(input, n, own)`;
`builder/model.js` v26to27.

**What to look at:**
- **Select an object and choose File › Export ▸ 3D print…** The dashed box should fit the object, turned with it if
  it is turned. Export the 3MF and open it in Bambu Studio: is the object alone, upright in its own frame, the right
  size, and solid?
- **Then Whole scene:** the box should hold the scene's objects but not the floor or the lights. Type a smaller size
  and check that the print is cut there.
- **A scene saved with an export box** should open without it, with nothing else changed.
- **How long the first export of an object takes on your card** (its own compile).
