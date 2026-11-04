bump: minor

**A STEP face on a B-spline is fitted with the nearest plane, cylinder, cone, sphere or torus: exactly when it is one,
and within a deviation you allow, shown red, when it is not.** Some exporters write every face as a B-spline. Those
faces now come in as the surfaces they are: a plate made all NURBS in OpenCascade imports as the plate's own 6 shapes.
A face that is truly freeform -- the sides of a block whose top is turned 3 degrees on its bottom, each 0.2 mm from any
plane or cylinder -- is refused at the default allowance (0.05 mm), and the import dialog says the deviation it would
import at. Type it into **Max surface deviation** and press **Re-convert**: the part comes in with those faces fitted,
their shapes red (a material of its own, *approximated face*) and called *fitted ...* in the tree. Untick **Show the
fitted faces in red** to give them the part's material instead. A surface of linear extrusion is fitted the same way;
a surface of revolution or an offset surface is still refused by name. Found on the way: a closed edge on a B-spline
(a NURBS circle, one vertex at both ends) was read as a single point, so a hole written that way had no rim; it is the
whole curve now, and B-spline edges are sampled at 48 points at least.

**What to look at:** import import/test/fixtures/twisted.step. The dialog should say it would import at 0.2 mm; type
0.2 and Re-convert. The block's four sides should be red, its top and bottom not, and with the box unticked all of it
should be the scene's material. Import import/test/fixtures/nurbsplate.step: it should look exactly like plate.step,
with nothing red.
