# Objects, groups and the tree

Everything in a scene is a row in the [Scene tree](show:scene): objects (shapes), lights, groups that hold them,
and the scene's materials at the bottom. The scene's own row is the root. Click it for the scene's unit,
radius and environment.

## Selecting

- **In the tree**: click a row. Only its chevron folds it.
- **In the picture**: click an object. The first click picks its top-level group. **Shift-click** goes one
  level deeper, **double-click** to the deepest, and **Esc** goes back up.
- **Double-click a row** to bring the camera to it.

Whatever is selected, the tree row, [Properties](show:properties) and the handles in the picture follow it.

## Adding

**+** on a row adds to that group: a group, a shape (primitives, optics, from points), a modifier, a
light, a material, or something from the [Library](show:library). You can also drag Library items into the tree
or onto the picture: a shape lands on the surface where you drop it, and a material lands on the object under the
pointer. A material dropped on a group's row is [the group's](materials.md#a-groups-material), worn by everything
in it. A material from the tree's own **Materials** can be dragged onto an object's or a group's row the same way.

## Moving, turning, sizing

With **✎ Edit** on (bottom left of the view), a selected object gets its handles. **✥ Transform** has them all at
once:

| handle | does |
|---|---|
| an arrow | moves along that axis |
| a square | moves in that plane |
| the centre ring | moves in the plane facing you |
| a quarter arc | turns about the axis of its colour |
| a cube on an axis | stretches the shape by its own sizes: a box's size, a cylinder's radius or height |
| the dashed circle | scales the whole thing |

**Ctrl** while dragging snaps to the grid, to 15° turns, or to 0.1 in scale. **Esc** during a drag puts it back.
**local** turns the handles with the object instead of keeping them on the parent's axes.

The numbers at the top right of the view show position, rotation, scale and the shape's lengths, live. Fold them
away with ▾. To type an exact value, use Properties.

**⌖ Points** edits a profile's or a path's points in the picture ([Shapes from points](points.md)).

## How a group combines its children

Each child of a group **joins what is above it** in that group. The mark in front of the row says how:

| mark | join |
|---|---|
| ● | the base: the first shape, which the others meet |
| ∪ | union: added |
| − | subtract: cut away |
| ∩ | intersect: only where both are |

Click a mark to change it. A group's **blend** smooths every join in it, and a child's own blend overrides that for
its join. A subtraction cuts only what is above it in the same group: to cut one part, put the part and the cutter in
a group of their own. A group among the children is one shape there, all of its children together: a group of two
overlapping cylinders, set to subtract, cuts away both, overlap and all. An array's copies count as one shape too.

Each part of the surface wears the material of the shape that makes it there: a hole has the cutter's material on
its walls, and an intersection has the second shape's wherever that shape bounds it. To cut a hole in the base's own
material, give the cutter the base's material.

A group's Properties also show its joins as a **recipe**, text you can read and type:

```
blend 0.1
union a, b, c
subtract d  blend 0.02
```

The letters are the children in order, as the tree labels them.

## Hiding, locking, copying

- **The eye** hides a row. Normally hiding recompiles the scene without it. Turn on *instant hide / show* in the
  scene's Properties to make hiding instant, at a small cost to every picture.
- **The lock** holds what it says: the position, the parameters, or both. A locked object loses those handles.
- **Ctrl C, Ctrl V, Ctrl D** copy, paste and duplicate in the tree, through the system clipboard, so also between
  tabs. Right-click a row to copy or move it to another scene of the project, or drop it on that scene's card over
  the tree (hold Shift to move it).
- **Ctrl Z / Ctrl Shift Z** undo and redo across the whole project (↶ ↷ on the menu bar, after the menus).

## When the picture waits

Moving, turning, stretching and every number in Properties are **live**: the picture follows with nothing to wait
for. Adding, deleting or re-joining a shape changes the program the graphics card runs, so it is **compiled**
first: a bar over the picture shows how far it has got. Once the edits stop for a moment, the scene is compiled once
more in the background with its values fixed, which renders faster; the status bar says *baked*. The next edit
returns to the editable build without waiting.

Try it in [Combining shapes](example:combining-shapes.json): the die is a cube, intersected with a sphere to round
its corners, with its pips subtracted.
