# Add-ins

An add-in is an ES module from outside this repository that the page imports when it starts. It can add panels,
commands and settings, and it reaches the renderer, the scene, the optics and the scripts. It is how a feature that
is not to be published, or not yet, works inside ShadyTracer: its source lives in a private repository of its own,
and nothing in this repository names it.

- The loader is `lib/addins/loader.js`, the API an add-in is given is `lib/addins/api.js`, and the panel is
  `lib/addins/panel.js` (**Help › Add-ins…**).
- To start a private repository, copy [`docs/addins/template/`](addins/template/README.md). It has an example
  add-in, a manifest and a deploy workflow.
- `lib/addins/test/loader.test.mjs` runs the loader, the API and the example over stand-ins, with no browser.

## What is private, and from whom

| | hidden? |
|---|---|
| from the public, with the add-in in a private repository, served locally or behind a login | **yes** |
| from whoever runs it: every module and shader the page loads is readable in the developer tools | **no** |
| what an add-in computes on a server of yours and only sends the answer of | **yes**, from everyone |

ShadyTracer is MIT-licensed. Moving a published feature into an add-in makes only its further development private.

## Where the page finds add-ins

Each URL is loaded once, and the first source that names it is the one the list shows:

1. **`addins.json`, next to `app.html`.** It is a JSON list of module URLs, each read relative to the manifest
   (strings, or `{ "url": ... }`). This repository ships it empty, as `[]`. A private deploy writes its own.
2. **The address.** `?addins=<manifest URL>` and `?addin=<module URL>`, each of which may repeat.
3. **Your list.** Kept in this browser and edited under **Help › Add-ins…**.

**Trust.** An add-in runs as the page does, with your projects in it. A URL from the address loads without
asking only if it is on the page's own origin or on `localhost`, `127.0.0.1` or `[::1]`. Any other URL is asked about
first, and once you allow it, it joins your list.

**Safe start.** A safe start loads no add-ins. That is `?safe` in the address, or a start that follows one that never
finished: an add-in may be why it never finished.

**Failures.** An add-in that fails is marked in the panel, with its error, and logged in the console. The page carries on.
That covers a 404, a module with no declaration, the wrong API version, a duplicate id, a throw, or a promise that
never settles: an import gets 20 s, `register()` 10 s, `start()` 60 s.

## The module

```js
export const addin = { id: 'reverse-optics', name: 'Reverse optics', api: 1, version: '0.1' }

export function register(st) {        // early: panels, commands, settings
    const el = st.shell.panel({ id: 'main', title: 'Reverse optics' })
    st.shell.command({ id: 'open', menu: 'Analysis', label: 'Reverse optics…', run: () => st.shell.open('main') })
}

export async function start(st) {     // once the page is up
    const r = await st.script.optics.run()
    st.log(r.totals.detected)
}
```

**The declaration.**

- `id`: lower case letters, digits and `-`, a letter first, at most 40 characters. It prefixes everything the add-in
  registers.
- `api`: the contract it was written for, today `1`. The page refuses any other.
- `name` and `version`: what the panel shows.

**The two functions.** Export either one or both:

- **`register(st)`** runs early, after the page's own panels exist and before the shell makes the View entries and
  restores the saved layout. Panels and commands belong here. A panel registered after the restore is left out of a
  saved layout (`lib/shell/README.md`).
- **`start(st)`** runs once the page is up: the renderer, the builder, the optics page, the first compile, and the
  project as it was left. The page does not wait for it before it renders.

## `st`: the contract (API 1)

| member | what |
|---|---|
| `st.addin` | the declaration |
| `st.app` | `{ version, text }`: the page's version, and its build line (version and revision) |
| `st.shell.panel(def)` | a panel, `addin.<id>.<def.id>`; returns its element to fill. `def` is as the shell's `panel()` (`title`, `help`, `renderer`, `popout`, `closable`, `menu`). It has a View entry unless `menu: false` |
| `st.shell.command(def)` | a command, `addin.<id>.<def.id>`: `{ menu, group, label, keys, help, run, when, items }`. It is always in the palette (Ctrl K), and in a menu when `menu` names one |
| `st.shell.open / close / isOpen / onVisible(id, ...)` | the add-in's own panels, by their short id |
| `st.shell.status(text)`, `st.shell.progress(key, job)` | the status bar, and a job's bar in it |
| `st.shell.searchIn(fn)` | another source the palette searches |
| `st.shell.tools`, `st.shell.barEnd` | the menu bar's elements to append buttons to |
| `st.params.provide(fn)` | the add-in's own settings, `addin/<id>/<path>`. They appear in the Parameters panel, the palette, the timeline and scripts. Entries are as `lib/shell/params.js` takes them |
| `st.params.path(p)` | the full path of one of them |
| `st.params.read / write / apply / list / get / has / find / onChange` | every setting of the page by its path (`renderer/...`, `scene/<node>/<param>`, ...) |
| `st.script` | from `start()`: the scene script's API (`tools/scriptapi.js`, and the Script panel's Reference). `params`, `param`, `settled()`, `camera`, `exposure`, `picture`, `render`, `optics.configure / run / last`, `files`. A run's result gives the far field, detectors, hits and illuminance maps |
| `st.scriptApi({ signal, log })`, `st.stop()` | another script API with a stop of your own, and the stop of `st.script` |
| `st.builder.edit(label, fn)` | from `start()`: `fn(doc, model)` changes the scene worked on with `builder/model.js`'s functions. It is one step of undo, the tree is redrawn and the scene compiled. Await `st.script.settled()` before reading the picture |
| `st.builder.doc`, `st.builder.model`, `st.builder.nodeOfTag(tag)` | the document, the model's functions, and a node by its optics or pick tag |
| `st.rt`, `st.optics` | from `start()`: the renderer (`lib/pathtracer/README.md`) and the optics page |
| `st.importCore(path)` | a module of the page by its path from `app.html` (`'lib/pathtracer/optics/illum.js'`): the same instance the page runs, from wherever the add-in is served |
| `st.storage.get / set / remove` | JSON in this browser, under the add-in's id; storing nothing is not an error |
| `st.log`, `st.warn` | the console, marked with the add-in's id |
| `st.unstable` | the page's own objects, as the console has them: `SHELL`, `PARAMS`, `RT`, `BUILDER`, `OPTICS`, `gpu`, `Q`, `TIMELINE`, `SCRIPT`, `MEASURE`, `LIBRARY`, `HELP` |

**Stability.** Everything above `st.unstable` is kept from one version of the page to the next. A change that
breaks it raises `api`. `st.unstable` is all of the page, and there is no promise that any name in it is still there
next version.

If `st.rt`, `st.builder`, `st.optics` or `st.script` is read during `register()`, it throws and says so.

## Not there yet

- **An add-in's own data in a scene or project file.** That is a change to the file format. Until it exists, keep
  data in `st.storage` or in a file the user saves (`st.script.files.save`).
- **New shapes in the builder's + menu.** Its menu is built when `builder/tree.js` loads. An add-in can put a node
  in the scene with `st.builder.edit` and `model.addObject(doc, parent, { code, params })`: any shape is code.
- **Unloading.** A module cannot be taken out of a page. Removing an add-in from your list takes effect at the next
  load.
