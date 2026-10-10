# `lib/dockview/` — the docking library, vendored

[dockview](https://github.com/dockview/dockview) **8.3.1**, MIT (see `LICENCE.md`), by mathuo.
The docking under `lib/shell/`: panels that can be dragged, docked, stacked, floated, popped out
into their own browser window (a second monitor), maximised, and saved and restored as JSON.

| file | from the npm package `dockview@8.3.1` | sha256 (first 16) |
|---|---|---|
| `dockview.min.js` | `dist/dockview.min.js`, the UMD build: sets `globalThis.dockview`, carries `dockview-core` inside it, no dependencies | `5071ec4fa85dfd5f` |
| `dockview.css` | `dist/styles/dockview.css` | `8bfea659cf7d780c` |

**Loaded with a script tag**, before any module that uses it:
`<script src="…/lib/dockview/dockview.min.js"></script>`. The package's ES build imports
`dockview-core` by a bare name and needs a bundler, which this repository does not have.

**What is free and what is not.** Everything used here is in the free package: docking, floating
groups, pop-out windows, maximise, `toJSON` / `fromJSON`. The separate paid `dockview-enterprise`
adds modules this application does not use: auto-hiding edge groups, pinned tabs, multi-row tabs,
keyboard docking, layout history, smart guides, the docking compass and advanced overflow. The core
names them only to print an install hint (`ENTERPRISE_MODULE_NAMES`). Nothing here should come to
depend on one without that decision being made on purpose.

**Updating it:** `npm pack dockview@<version>`, copy the two files above, update the version and
the hashes here, then run `node lib/shell/test/example.check.mjs` (and look at the application).
