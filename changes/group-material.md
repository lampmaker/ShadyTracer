bump: minor

**A group can give one material to everything in it.** Shapes that make one part are mostly the same stuff, and a
material dropped on a child changed only that child: a part of twelve shapes was twelve drops. Now a group has a
**material** in its Properties, and a material dropped on a group's row in the tree is the group's. Every object in the
group wears it instead of its own, also in groups inside it. The nearest group with a material wins, as a nested
group's blend is its own. **Exceptions work like a child's own blend.** An object with **own material** checked keeps
its own, and a material dropped on an object under such a group checks it. Each object keeps its own material
underneath, so choosing *(each its own)* for the group gives every object back what it had.
- **Before, a material dropped on a group's row was put on every object in it**, replacing what each had. Now it is the
  group's, and what was there stays underneath.
- **Copied, pasted, dragged to another scene or kept in the library**, a node takes what it wears with it. An object
  copied out of such a group takes the group's material as its own, and a group inside takes it as its group material.
- **Scene format 23** (`builder/model.js` VERSION): a group's `material` and an object's `ownMaterial`. Version 22 files
  have neither and read unchanged. A builder of 22 refuses a file of 23, rather than show each object in its own
  material and save the scene without the group's. The examples and fixtures are re-stamped 23, nothing else changed.
- **Nothing new in the shader.** The group's material is put on each object in `model.js toTree`, before codegen, the
  scene as data and the bake. A scene with a group material compiles to exactly the text of the same scene with each
  object given that material itself (`model.test.mjs`). As data it is another record and the same text, no compile,
  checked on the five examples and fixtures that have a top-level plain group (`scenedata.test.mjs`). A scene with none
  is the text it was: the golden shaders are unchanged.
- **The tree** shows a group's material on its row, each object the material it wears, and `(own)` on one that keeps
  its own under a group's.

**What to look at:** in the Combining shapes example, select the group **die (16 mm)** and pick a **material** in its
Properties: the die and its dots should all change, and their rows in the tree should name it. Drag a different
material from the Library onto one dot: only that dot should change, its row reading `(own)`, and its Properties
showing **own material** checked. Uncheck it: it should wear the group's again. Choose
*(each its own)* on the group: every object should be back as it was. Then drag a material from the Library onto the
group's row in the tree.
