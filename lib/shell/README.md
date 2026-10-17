# `lib/shell/` — an application shell: a menu bar, a dock of panels, a status bar

Project-agnostic, like everything in `lib/`: it knows nothing about renderers, optics or scenes.
An application registers **panels** (what can be docked), **commands** (what can be done) and
**parameters** (every setting, by a path). The menu bar, the View menu, the palette and the
Parameters panel are made from those registrations, not written by hand.
The reasoning is in `roadmap/UI_PLAN.md` (sections 6–8).

```js
// in the page's head: lib/dockview/dockview.css, lib/shell/shell.css, and
// <script src="…/lib/dockview/dockview.min.js"></script>
import { createShell } from '…/lib/shell/shell.js'
const S = createShell(document.body, { title: 'My app', menus: ['File', 'Edit', 'View', 'Window', 'Help'],
                                       storageKey: 'myapp.layout', popoutUrl: 'popout.html' })
const el = S.panel({ id: 'view', title: 'View', module: 'renderer', renderer: 'always', popout: false, closable: false })
// ...fill `el` once; the dock moves it, never rebuilds it
S.command({ id: 'file.save', menu: 'File', group: 'save', label: 'Save', keys: 'Ctrl S', run: save })
S.command({ id: 'file.recent', menu: 'File', label: 'Recent', items: () => [{ label: 'a.json', run }] })   // a submenu row ▸
S.layout.setDefault(() => { S.open('view'); S.open('tree', { referencePanel: 'view', direction: 'left' }, { width: 300 }) })
S.standardCommands()          // View: one entry per panel, Reset; Window: float, pop out, maximise, close
S.standardCommands({ window: false, layouts: false })   // ...or with those and "Layout: X" in the palette only (menu-less)
S.tools.appendChild(button)   // the host's own buttons on the menu bar, right after the menus (the raytracer's Undo / Redo)
S.layout.preset('Analyse', () => { ... }, 'what it is for')   // in the menu bar's switcher and View
S.layout.onApply(() => S.open('view'))                        // what every layout must still have
S.layout.restore()            // the user's last arrangement, or the default
S.open('output', undefined, undefined, { floating: { width: 380, height: 360 } })   // a dialog-like panel
S.onVisible('chart', v => { if (v) draw() })

// THE PARAMETERS: the timeline's registry contract, with a path for an id
import { makeParams } from '…/lib/shell/params.js'
import { installParamsPanel, paramsSearch } from '…/lib/shell/paramspanel.js'
const P = makeParams()
P.provide('renderer', () => RT.parameters())      // asked afresh every time: never cached
P.write('renderer/tracing/maxbounce', 12)          // coerced, set, an undo step, listeners told
installParamsPanel(S.panel({ id: 'parameters', title: 'Parameters' }), P, { reveal, say: S.status })
S.searchIn(paramsSearch(P, { reveal, say: S.status }))   // Ctrl K finds settings; "name = value" sets one
```

| file | what |
|---|---|
| `registry.js` | panels and commands as data, and the menu model made from them (pure; Node-tested) |
| `shell.js` | `createShell`: the frame, the dock (dockview), the menus, layout save / restore / reset, visibility |
| `shell.css` | its look: the mockups' slate palette as tokens, dockview and the property tables (Tweakpane) themed from them |
| `params.js` | `makeParams`: the parameter registry, every setting by a path; the timeline's registry contract (pure; Node-tested) |
| `paramspanel.js` | the Parameters panel (every entry by name and value, filtered, typed into; right-click copies a path) and `paramsSearch`, the palette's source of settings |
| `example.html` | the shell alone with plain panels, over http:// from the repository root |
| `test/registry.test.mjs` | the registries (Node) |
| `test/params.test.mjs` | the parameter registry, a timeline track driving it, and the renderer's settings in it (Node) |
| `test/example.check.mjs` | `example.html` driven in headless Chromium (optional: needs Playwright; says so when it is missing) |

## Contracts worth knowing

- **A panel's element is made once**, by its owner, at registration. Closing a panel detaches the
  element and opening it again puts back the same element, with its state. Code written for a fixed
  page runs in a panel unchanged.
- **Register every panel before `layout.restore()`.** A saved layout names panels by id; one not
  registered yet is dropped from it. Register early, fill later.
- **Ids are forever.** Layouts are saved by panel id; renaming one loses its place in every saved
  layout.
- **A panel made at run time** (a chart the user adds) is registered with `panel()` like any other,
  then `standardCommands()` again for its View entry. The owner keeps the list of such panels itself
  and registers them again before the next `layout.restore()`, or the saved layout loses them.
  `forget(id)` lets one go: closed, its element and View entry dropped, the id free again.
- **View is the list of panels.** `standardCommands()` gives each one a `view.<id>` entry unless it has one
  already -- so an owner that opens a panel its own way (floating, in a set place) registers `view.<id>` itself
  first -- or the panel was registered with **`menu: false`** (one another menu opens).
- **A menu with nothing in it has no button.** A host that keeps every row out of a menu (`window: false`)
  gets no empty Window on its bar, whatever its `menus:` list says.
- **A submenu row** is a command with `items: () => [{ label, run, off, title }]`, asked for each time it
  opens and drawn beside it (menu.js `flyout`). It is never a palette answer: it is not one verb.
- **`renderer: 'always'`** keeps a panel's element in the page while another tab covers it (a canvas
  that must not be detached). **`popout: false`** refuses pop-out for any group holding it, with a
  reason in the status bar: a WebGPU canvas belongs to the document that made it. **`closable:
  false`** hides its close button.
- **Popped-out windows are not saved.** Reopening one at load is a `window.open` no click asked for,
  which popup blockers refuse. Their panels are left out and can be reopened from View.
- **`onVisible(id, fn)`** is told on every change, and one frame after registering whether the
  panel is visible now. An owner registering after the restore still learns it is on screen.
- **Presets are where to start, not modes.** Applying one replaces the arrangement; whatever the user
  changes from there is what is kept. The user's own layouts (＋ in the switcher, or View > Save
  this layout as…) are kept under `<storageKey>.saved`, without pop-outs.
- **Ctrl K (or Ctrl Shift P) opens the command palette**: every enabled command by name, the View
  entries included, so a panel opens by typing its name. The shell binds this key itself.
- **A parameter's path is its id, and ids are forever**: a timeline track or an optimiser's variable
  saved against one names nothing once it moves. Paths say what a setting changes
  (`scene/<node id>/…`, `scene/environment/…`, `view/…`, `renderer/…`), never which page shows it.
- **Providers are asked every time.** The scene's parameters are its nodes', which come and go with
  every edit, undo and file; a cached list would be right until the first delete.
- **`write` is an edit, `apply` is not.** `write` makes an undo step where the entry keeps them and
  throws on an unknown path or a wrong shape; `apply` (the timeline's verb) is quiet and skips unknown
  paths. Each entry says whether a change is `live` (a uniform) or `structural` (a compile).
- **A control that edits a value itself** (a slider bound to the document) calls `P.changed(path)`,
  so everything else that shows it follows.
- **Shortcuts are shown, not bound.** `keys` is a label; the command's owner listens for the key
  itself, as it already did.
