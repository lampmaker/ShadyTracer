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
  - your projects in this browser: open, new, rename, duplicate, download, delete;
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
| **File › Export ▸ 3D print (3MF / STL)…** | the scene's export box: its Properties hold the two exports (below) |

Files from older versions are upgraded when opened. A file with problems is refused, with every problem listed.

## The library

The [Library](show:library) holds things to put in: every shape, modifier and light; materials with real values;
optics parts. Each has a rendered picture. Rest the pointer on one to see it rendered live.

- **Double-click** an item to put it in at the selection, or **drag** it onto the tree or into the picture.
- **Keep your own**: select something in the tree and keep it as a library item, with a name, tags and a tooltip.
  You can rename, edit, duplicate, export and import your items.
- **Search** by name, category or help text, and filter by kind.

## Export for 3D printing

Put an **export box** (+ in the tree) around what you want printed, and size it with its handles. Its Properties
export:

- **3MF with colour**: each triangle coloured from its material, reduced to as many colours as your printer holds
  (*colours*, 4 to start), for a slicer's filament mapping;
- **STL**, in millimetres.

The shape is sampled on a grid -- the box's **cell**, in millimetres of the printed part, 0.4 to start -- and made into
a closed mesh. What to expect:

- features thinner than a cell disappear;
- sharp edges are bevelled by up to a cell;
- the meshes are dense, because nothing reduces them yet.

A smaller cell is finer and slower, and makes a larger file.
