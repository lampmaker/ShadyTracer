# Projects, files and the library

## Projects and scenes

Your work is a **project** of one or more **scenes**, kept in the browser and saved as it changes. Reloading the page
brings back the same scene, camera and settings. **Ctrl S** (*File › Save now*) saves at once.

- **File › Projects…** lists your projects: open, new, rename, duplicate, download, import, delete.
- **File** has the scenes of the project: *New scene*, *Switch to scene ▸*, and *Rename*, *Duplicate*, *Move* up or down and
  *Delete this scene*.
- **File › Examples** adds a copy of an example to the project, to work on.
- Right-click a row in the tree to copy or move it to another scene.
- A second browser tab on the same project works on its own copy, so two tabs never overwrite each other.

The browser's storage is per browser and per computer. To move work elsewhere or keep a backup, download it.

## Files

| | |
|---|---|
| **File › Open a file…** (Ctrl O), or drop a file on the page | a scene or project file joins this project; a workspace file becomes a project of its own |
| **File › Save this scene to a file** | the scene being worked on, alone |
| **File › Save all scenes to a file** | every scene of the project |
| **File › Save the project to a file** | the scenes with their cameras and renderer settings: exactly what you see |

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
