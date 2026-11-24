bump: minor

**Add-ins: modules from outside this repository, loaded into the page as it starts** (`lib/addins/`,
`docs/ADDINS.md`). An add-in is an ES module with a declaration (`addin = { id, name, api: 1 }`) and two functions:
`register(st)`, called before the View entries are made and the layout restored, so its panels and commands keep their
place in a saved layout; and `start(st)`, once the page is up. `st` is the contract:

- the shell (panels, commands, the status bar, the palette), each under the add-in's id;
- the parameter registry, with the add-in's own settings under `addin/<id>/`;
- the scene script's API (settings by path, `settled()`, renders, the optics analysis);
- the builder (an edit is one step of undo and a compile);
- the renderer and the optics page, and a namespaced storage.

`st.unstable` hands over the page's own objects, with no promise across versions.

The page finds add-ins in `addins.json` beside `app.html` (empty here, written by a private deploy), in the address
(`?addins=`, `?addin=`), and in your own list under **Help › Add-ins…**. From the address, only the page's own origin
and `localhost` load without asking; anything else is asked about first and then remembered. A safe start loads none.
An add-in that fails, by a 404, a throw, a hang or the wrong API version, is said in the panel and stops nothing else.

`docs/addins/template/` is the start of a private repository: the public one as a submodule, an example add-in (one
setting swept against a detector's uniformity, the loop an inverse design is made of), and a workflow that publishes
both behind a login on Cloudflare Pages (not GitHub Pages, whose sites are public).

**What to look at:**
- With no add-in, the page starts as before.
- **Help › Add-ins…** says "None".
- Serving the template's copy locally with `?addins=/addins.json`:
  - **Analysis › Example: sweep a setting** opens its panel;
  - a live scene setting swept against a scene with a detector prints each step's U0, and leaves the setting at the
    best;
  - the panel says *started*.
- `?safe` loads none.
