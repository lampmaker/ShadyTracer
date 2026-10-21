bump: patch

**A group used as one shape of a join is one shape: its children are a union.** A group whose children all join by
union is a plain group, and its children went into the scene one by one (`scene_api.js fold`). That keeps the nearest
surface by size, inside or out. It is what the march needs of separate objects, but it is not a union's signed
distance: at a point 0.6 inside one shape and 0.004 outside another that overlaps it, fold says +0.004, "outside".
When such a group is one of a CSG group's shapes (subtracted, intersected, or the base of a cut), the CSG group reads
that value as its operand, so wherever the group's children overlap it cut or kept the wrong part. The STEP/STL
import's GPU check found it (0.73.0, IMPORT.md 11.3), and the import stopped making such groups; groups built by hand
still had it. Measured on Dawn over lavapipe (`builder/test/csgshape.gpu.mjs`, new; arithmetic, not speed): a box less
a group of two overlapping spheres was wrong at 94 of 4096 points, by up to 0.59, 64 of them on the wrong side of the
surface, and every case the test makes was wrong the same way in codegen and as data. Now none is.
- **Such a group's children are combined first** (`codegen.js combinedGroups`), each child on its own and joined by a
  hard union (`csgUnion` at the group's blend, which is 0), exactly as a union group with a blend of 0 is. Plain groups
  inside it are combined the same way. **An array** that is one of the shapes combines its copies too: one combine
  around its loop, where each copy had been folded on its own and the copies' overlaps were wrong as well.
- **The scene as data** (`scenedata.js`) does the same: a CSG record, a union JOIN after each child, an END. An array
  gets a CSG record around it.
- **Fixed alongside, in the scene as data** (the editing build by default since 0.74.0, on a card with a ninth storage
  binding: `builder/demo.js` dataMode): a twist, mirror, round or shell whose own children join (a mirror of a box less
  a sphere) was walked as records that folded its children in one by one. Codegen combined them; the records drew the
  box and the sphere. Such a group is now compiled as before.
- **Not changed:** group code that is one of a CSG group's shapes (a mirror or a shell, say) is still handed its
  children as they fold. The top level, and a plain group outside any CSG group, still fold each child into the scene
  on its own, which keeps each child's material and the medium inside exact. The import still makes every group one
  fold of joins (`import/shapes.js` addPart: a part's own group is not a CSG group's shape unless it is pasted into one).
- **The import's mirror** (`import/test/docsdf.mjs`) combines such a group as codegen now does, so it still mirrors it.
- **The golden shaders moved for four documents**: test/fixtures/scenes/OpticsBench.json and OpticsBench2.json and
  their bench copies. Each pillar's cylinder and shell, and OpticsBench2's laser rig under its lens holder, are such
  groups. Checked against `dev`'s codegen before refreezing: no line left any text (whitespace aside), and the only
  lines added are those groups' combines and a blend uniform at 0 each. The tags did not move, nor did the other 46
  documents, the imported parts among them.
- **Its cost is not measured.** Each child of such a group now has an empty Hit of its own and a `csgUnion`, as in any
  CSG group (read in code). How much that adds per step on a card is a question for Tests on hardware.

**The tutorial:** chapter 3 (Building and bending shapes) says why a group that is one shape of a join is joined by a
hard union before it is folded; chapter 24 (From scene tree to shader) lists the bug among those its codegen has had.
Chapter 33 (Open problems) loses the limit 0.73.0 gave it, its card and its clause, and `roadmap/PLAN.md` and
IMPORT.md 11.3 say it is fixed. No excerpt's code changed, so nothing was stamped.

**What to look at:** a group of two overlapping cylinders, set to subtract from a box: the cut follows both cylinders,
overlap and all, with no stray surface inside it, in the editing build and once it is baked. The same group
intersected with the box keeps exactly the cylinders' union. OpticsBench and OpticsBench2 should look as they did:
their groups are joined by union, and fold and a union differ only at points inside the shapes, so every surface seen
from outside is where it was. If either renders noticeably slower, the extra Hits are the place to look.
