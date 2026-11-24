//======================================================================================================================
// WHAT AN ADD-IN IS HANDED: `st`, one per add-in (loader.js makes it; docs/ADDINS.md is its reference).
//
// Two layers, on purpose:
//   the contract   st.shell, st.params, st.script, st.builder, st.storage, st.importCore -- names kept from one
//                  version of the page to the next (ADDIN_API in loader.js says which contract this is). st.script is
//                  the scene script's own API (tools/scriptapi.js), the one already held to its words by
//                  tools/test/script.test.mjs: settings by path, settled(), the camera, renders, the optics analysis.
//   st.unstable    the page's own objects (RT, BUILDER, OPTICS, SHELL, PARAMS, ...): everything, as the console has it,
//                  with no promise that a name is there next version. What reaches "every part of the page" without
//                  every internal function becoming a contract.
//
// NAMES. An add-in's panels, commands, status jobs, settings and storage carry its id (`addin.<id>.` for the shell's
// ids and storage, `addin/<id>/` for a setting's path), so two add-ins never collide with each other or with the page,
// and a saved layout or a timeline track names an add-in's panel or setting for good.
//
// WHEN. Some of the page is there only at start(): reaching st.rt, st.builder, st.optics or st.script during register()
// throws, saying so, rather than handing back an undefined that fails somewhere else.
//======================================================================================================================

/**
 * @param decl  { id, name } -- the add-in's declaration (loader.js declarationOf)
 * @param host  what the page hands in, read when used (so start's additions are seen):
 *   register:  SHELL, PARAMS, base (the page's address), storage (localStorage or null), app ({ version, text }),
 *              importer (url => import(url))
 *   start:     started: true, RT, BUILDER, OPTICS, gpu, scriptApi ((signal, log) => tools/scriptapi.js's API),
 *              edited (() => the tree and panel redrawn and the scene compiled, after a builder edit), others
 */
export function makeAddinApi(decl, host) {
    const id = decl.id
    const own = s => `addin.${id}.${s}`
    const ownPath = p => `addin/${id}/${String(p).replace(/^\/+/, '')}`
    const late = what => { if (!host.started) throw new Error(`add-in ${id}: st.${what} is there from start(), not register()`) }
    /* host[k], from start(), as st.<member> -- or a throw naming the member, or the page's missing part */
    const need = (k, member, what) => { late(member); if (!host[k]) throw new Error(`add-in ${id}: this page has no ${what}`); return host[k] }
    const say = (kind, a) => (console[kind] ?? console.log)(`[${id}]`, ...a)

    /* THE SHELL: panels, commands, the status bar, the palette (lib/shell/shell.js) */
    const S = () => host.SHELL
    const shell = Object.freeze({
        /** Register a panel and get its element, to fill once: { id, title, help, renderer, popout, closable, menu,
         *  position, size } as the shell's panel(). Its id becomes `addin.<id>.<id>`; it has a View entry unless
         *  `menu: false`. */
        panel(def) {
            if (!def?.id) throw new Error(`add-in ${id}: a panel needs an id`)
            const e = S().panel({ module: 'addin', ...def, id: own(def.id), title: def.title ?? def.id })
            /* after the page's own View entries were made (at start), this one's is made now -- never before, since the
               first call is the page's and sets which of the window verbs go in a menu (app.html) */
            if (host.started) S().standardCommands()
            return e
        },
        open: (pid, position, size, opts) => S().open(own(pid), position, size, opts),
        close: pid => S().close(own(pid)),
        isOpen: pid => S().isOpen(own(pid)),
        onVisible: (pid, fn) => S().onVisible(own(pid), fn),
        /** A command: { id, menu, group, label, keys, help, run, when, items } as the shell's command(); its id becomes
         *  `addin.<id>.<id>`. In the palette (Ctrl K) always, in a menu when `menu` names one. */
        command: def => {
            if (!def?.id) throw new Error(`add-in ${id}: a command needs an id`)
            return S().command({ group: `addin.${id}`, ...def, id: own(def.id) })
        },
        status: text => S().status(text),
        /** A job's bar in the status bar, as the shell's progress(): (key, { label, done, total } | { fraction } | null). */
        progress: (key, job) => S().progress(own(key), job),
        /** Another thing the palette searches: fn(query) -> [{ label, where, run }]. Returns the undo. */
        searchIn: fn => S().searchIn(fn),
        /** The menu bar's place for buttons after the menus, and its right end: append to them. */
        get tools() { return S().tools },
        get barEnd() { return S().barEnd },
    })

    /* THE SETTINGS (lib/shell/params.js): the page's, read and written by path; and the add-in's own, provided under
       addin/<id>/ -- in the Parameters panel, the palette, the timeline and scripts like any other */
    const P = () => host.PARAMS
    const params = Object.freeze({
        /** The add-in's own settings: fn() -> entries as the registry takes them ({ path, label, get, set, min, max,
         *  step, options, dims, unit, help, kind }), each path relative ('gain' is addin/<id>/gain). Asked afresh on
         *  every read, as every provider is. Returns the undo. */
        provide: fn => P().provide(`addin.${id}`, () => (fn() || []).map(e => ({ group: decl.name, ...e, path: ownPath(e.path ?? e.id), id: undefined }))),
        /** The full path of one of the add-in's own settings. */
        path: ownPath,
        list: prefix => P().list(prefix),
        get: path => P().get(path),
        has: path => P().has(path),
        read: path => P().read(path),
        /** Set a setting (coerced to its range); throws for a path that does not exist. { quiet: true } adds no undo step. */
        write: (path, v, opts = {}) => P().write(path, v, { source: `addin.${id}`, ...opts }),
        /** Write { path: value } quietly, as the timeline does; returns the paths that were known (an unknown one is
         *  skipped, not thrown: write() is the strict one). */
        apply: values => P().apply(values, `addin.${id}`),
        find: (q, limit) => P().find(q, limit),
        /** Be told of every write: fn({ path, value, source }). Returns the undo. */
        onChange: fn => P().onChange(fn),
    })

    /* THE SCENE'S SCRIPT API (tools/scriptapi.js), the add-in's own: a stop of its own (stop() below), its log the
       console's. scriptApi() makes another, with a signal and a log of the add-in's choosing */
    let scriptOwn = null
    const stopper = new AbortController()
    const scriptApi = ({ signal = stopper.signal, log = (text, kind) => say(kind === 'warn' ? 'warn' : 'log', [text]) } = {}) =>
        need('scriptApi', 'script', 'script API')(signal, log)

    /* THE BUILDER (builder/): the document and the model's pure functions; edit() is one step of the user's undo */
    const builder = Object.freeze({
        /** builder/model.js: addObject, addGroup, addMaterial, addParam, setCode, remove, ... (each (doc, ...)) */
        get model() { return need('BUILDER', 'builder', 'builder').model },
        /** The scene worked on, as a document. Read it; change it through edit(). */
        get doc() { return need('BUILDER', 'builder', 'builder').doc },
        /** Change the scene worked on: fn(doc, model) edits it with model.js's functions; then one undo step, the tree
         *  and properties redrawn, and the scene compiled. Resolves with fn's answer once the compile is under way;
         *  await st.script.settled() before reading anything off the picture. */
        async edit(label, fn) {
            const B = need('BUILDER', 'builder', 'builder')
            const out = fn(B.doc, B.model)
            B.commit(`addin.${id}.${label}`)
            await host.edited?.()
            return out
        },
        /** The tree's node for an optics or pick tag, or null. */
        nodeOfTag: tag => need('BUILDER', 'builder', 'builder').nodeOfTag(tag),
    })

    /* KEPT IN THIS BROWSER, under the add-in's id; nothing kept (a private window, storage off) is not an error */
    const storage = Object.freeze({
        get(key, fallback = null) {
            try { const v = host.storage?.getItem(own(key)); return v == null ? fallback : JSON.parse(v) } catch { return fallback }
        },
        set(key, value) { try { host.storage?.setItem(own(key), JSON.stringify(value)); return true } catch { return false } },
        remove(key) { try { host.storage?.removeItem(own(key)); return true } catch { return false } },
    })

    const st = {
        /** The add-in's own declaration: { id, name, api, version }. */
        addin: Object.freeze({ ...decl }),
        /** The page: { version, text } (version.js: the version and the build's line, its revision in it). */
        get app() { return Object.freeze({ ...(host.app ?? {}) }) },
        shell, params, builder, storage,
        /** The scene script's API (tools/scriptapi.js), stopped by stop(). From start(). */
        get script() { return scriptOwn ??= scriptApi() },
        /** Another script API: { signal, log(text, kind) } of the add-in's choosing. From start(). */
        scriptApi,
        /** Stop what this add-in's st.script is doing: its next call throws 'stopped'. */
        stop: () => stopper.abort(),
        /** The renderer (lib/pathtracer/index.js createPathTracer's object). From start(). */
        get rt() { return need('RT', 'rt', 'renderer') },
        /** The optics page (optics/page.js; its engine, lib/pathtracer/optics). From start(). */
        get optics() { return need('OPTICS', 'optics', 'optics page') },
        /** A module of the page by its path from app.html ('lib/pathtracer/optics/illum.js'): the same instance the page
         *  runs, wherever the add-in is served from. */
        importCore: path => {
            if (/^([a-z]+:|\/)/i.test(String(path))) throw new Error(`add-in ${id}: importCore takes a path within the page ('lib/...'), not '${path}'`)
            return host.importer(new URL(path, host.base).href)
        },
        /** The page's own objects as the console has them, with no promise that a name is there next version. */
        get unstable() {
            const { SHELL, PARAMS, RT, BUILDER, OPTICS, gpu, others } = host
            return Object.freeze({ SHELL, PARAMS, RT, BUILDER, OPTICS, gpu, ...(others ?? {}) })
        },
        log: (...a) => say('log', a),
        warn: (...a) => say('warn', a),
    }
    return Object.freeze(st)
}
