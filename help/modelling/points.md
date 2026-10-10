# Shapes from points

Some shapes are drawn as a list of points rather than given by a few sizes. Add one from **+ › Shapes › From points**,
or open [From points](example:from-points.json) to see four of them.

| shape | its points are | becomes |
|---|---|---|
| **extrusion** | an outline: `x, y` per point | that outline, pushed up by a height |
| **revolution** | an outline as `radius, height` | that outline, turned about the shape's z axis: a vase, a knob, a wine glass |
| **bent tube** | a path: `x, y, z` per point | a tube of a radius along it |
| **light guide** | a path, and a cross-section outline | the cross-section swept along the path |
| **twisted bar** | a path, with a scale and a twist per point | a section that narrows and turns as it goes |
| **Fresnel lens** | an outline, turned | a lens cut into rings |

## Writing points

A point is a line of numbers, in Properties:

- **an outline (a profile)**: `x, y`, and optionally a third number, the **fillet** radius that rounds that corner.
  The outline closes itself: the last point joins the first.
- **a path**: `x, y, z`, and optionally a fillet. After the fillet, a swept section can take up to three more:
  its **scale x**, its **scale y**, and its **twist** in degrees at that point. They change evenly along a
  straight and hold round a bend. A tube reads scale x as its diameter.

Any number can be an **expression of the object's parameters**: `0.5, 0.5, rise` or `width / 2, 0, height + 1`
(numbers, `+ - * /`, brackets, names). Move the parameter's slider and the points follow.

A path or profile marked **live** follows those sliders with no compile. Untick *live* once it is right: compiled in,
it renders a little faster.

## Editing points in the picture

Select the shape and choose **⌖ Points** at the bottom left of the view. Its points are drawn, joined by a dotted
line, with the curve as the shape will have it (in red, with the reason, if it cannot be made).

| do | to |
|---|---|
| drag a dot, an arrow or a square | move the point: freely, along one axis, or in a plane |
| drag the diamond | change the corner's fillet |
| **Delete** or **Backspace** | remove the selected point |
| **Insert** or **+** | add a point after it |
| **Enter** | type its numbers exactly (in the numbers box at the top right) |
| **Ctrl** while dragging | snap to the grid |
| **Esc** | cancel a drag; with none, let the point go |

At a path's point, its cross-section is drawn where it is swept, with handles for its scale and twist.

A point written as a parameter's name moves that parameter when dragged, within the parameter's range.

## When it says no

A fillet too large for the corner it rounds, or two points on top of each other, cannot be made. Typed or dragged in, it is refused and the reason is said. A path that names a parameter can be
dragged into such a state by a slider. Then it draws nothing until the slider comes back, so a file saved like that
still opens.
