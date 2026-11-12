# Projects, files and the library

## Projects and scenes

Your work is a **project** of one or more **scenes**, kept in the browser and **saved as it changes**: there is nothing
to save. Reloading the page brings back the same scene, camera and settings. The status bar says *saved*; **Ctrl S** still
writes at once, if you like to press it.

- **Over the tree**, one line names the project and counts its scenes, and a **card** for each scene shows its last
  picture and how long it took to open. The one you are working on is marked.
  - A **click** on another card shows it in Properties -- nothing is compiled.
  - **▶**, or a **double-click**, opens it: it is compiled, which takes a few seconds.
  - **⋯** (or a right-click): open, duplicate, export the scene to a file, delete. Drag cards to reorder them.
  - Drop a row of the tree on a card to **copy** it into that scene; hold **Shift** to **move** it.
  - **＋**: an empty scene, a copy of this one, or an example. **▾** folds the cards away.
- The scene is renamed by its row in the tree: select it, and change its label in Properties.
- **Undo** (Ctrl Z, Edit, or ↶ on the menu bar) of a change to the list of scenes -- a scene deleted, a copy sent to
  another scene -- keeps you on the scene you are working on.
- The **project's name** over the tree, or **File › Projects…**, opens the **Project panel**, a tab beside the picture:
  - your projects in this browser: open, new, rename, duplicate, download, delete. Opening one keeps you in the panel
    with its scenes, and nothing is compiled until you click the scene you want;
  - this project's scenes, larger;
  - the **examples**, by who they are for, each with what it shows: a click adds a copy to the project.
- Right-click a row in the tree to copy or move it to another scene.
- A second browser tab on the same project works on its own copy, so two tabs never overwrite each other.

The browser's storage is per browser and per computer. To move work elsewhere or keep a backup, export it to a file.

## Files

| | |
|---|---|
| **File › Import from file…** (Ctrl O), or drop a file on the page | a scene file joins this project; a project file asks: open it as a project of its own, or add its scenes to this one |
| **File › Export ▸ Scene file…** | the scene being worked on, alone (a card's ⋯ exports another) |
| **File › Export ▸ Project file…** | every scene, with their cameras and the render settings: exactly what you see |
| **File › Export ▸ 3D print (3MF / STL)…** | the selected object or the whole scene, as a mesh to print (below) |

Files from older versions are upgraded when opened. A file with problems is refused, with every problem listed.

**A STEP or STL file** (`.step`, `.stp`, `.stl`) is converted into the builder's own shapes and pasted into the scene
being worked on. A box shows how far the conversion is, with Cancel. When everything converted exactly it closes by
itself; otherwise it says, part by part, what happened before anything is pasted:

- how many of the conversion's own check points disagree with the part: small errors are possible there;
- the part's **fillets**, which come in as *round* joins of the two faces each one rounds (a group called *fillet R1*),
  and any it could not make one;
- faces on **freeform** (B-spline) surfaces: each is fitted with the nearest plane, cylinder, cone, sphere or torus.
  One that fits exactly is that surface. One that does not, but is within **Max surface deviation** (0.05 mm unless
  you change it), comes in **red** and is called *fitted* in the tree. A part with a face further off is left out,
  and the box says the deviation it would import at: type it and press **Re-convert**. Untick *Show the fitted faces
  in red* to give them the part's material;
- parts that could not be converted, and why. Each part of an assembly has a box: untick one to leave it out, then
  **Import what converted**.

## The library

The [Library](show:library) holds things to put in: every shape, modifier and light; materials with real values;
optics parts. Each has a rendered picture. Rest the pointer on one to see it rendered live.

- **Double-click** an item to put it in at the selection, or **drag** it onto the tree or into the picture.
- **Keep your own**: select something in the tree and keep it as a library item, with a name, tags and a tooltip.
  You can rename, edit, duplicate, export and import your items.
- **Search** by name, category or help text, and filter by kind.

## Export for 3D printing

**File › Export ▸ 3D print (3MF / STL)…** asks what to print:

- **Selected object**: that object alone -- or a group and everything in it -- with nothing of its neighbours, in its
  own frame: its z is up on the print bed.
- **Whole scene**: everything solid, as the picture shows it, in the world's frame. Lights and an endless floor are
  left out of the box it starts with.

The box is fitted to it, and drawn dashed in the picture while the dialog is open. Type another **size** to cut it, or
**Fit** to fit it again. Nothing is added to the scene. Then:

- **3MF with colour**: each triangle coloured from its material, reduced to as many colours as your printer holds
  (*colours*, 4 to start), for a slicer's filament mapping. With **colour from: As lit (the picture)** the colours are
  the part as the picture shows it instead: its light, shadows and glow, with the view's exposure and tone curve. The
  renderer traces the light at each point of the mesh, looking straight at the surface, for *samples* samples each
  (64 to start: more is less speckle, and longer). This suits matte surfaces. A glossy or mirror-like surface shows
  what it reflects straight out of it, and glass shows what is behind it. A light that is only a ray file (no face) gives
  no light here. Faces the box cuts through keep their material's colour;
- **STL**, in millimetres.

The shape is sampled on a grid -- the **cell**, in millimetres of the printed part, 0.4 to start -- and made into
a closed mesh, cut by the box. That mesh is then **simplified**: flat regions become a few large triangles, curved
ones keep small ones, and no vertex moves further than the **deviation** (in mm, 0.05 to start) from the planes of
the triangles it replaced. The borders between colours stay where they were, and no triangle changes colour. A
deviation of 0 keeps every triangle the grid gives. The cell, the colours, the deviation and the format are remembered
for the next export, and so is the choice of colour. What to expect:

- features thinner than a cell disappear;
- sharp edges are bevelled by up to a cell;
- a wall thinner than about twice the deviation can have its two sides pass through each other; a smaller deviation
  avoids it.

A smaller cell is finer and slower, and makes a larger file. A larger deviation makes a smaller file.
