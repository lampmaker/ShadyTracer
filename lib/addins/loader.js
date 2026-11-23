//======================================================================================================================
// ADD-INS: modules from outside this repository, loaded into the page at run time (docs/ADDINS.md).
//
// WHY. This repository is public and Pages serves all of it (.github/workflows/pages.yml), so a feature that is not to
// be published cannot live here. It lives in a repository of its own -- a private one -- as an ES module, and the page
// imports it when it starts. Nothing of it is in this repository, and nothing here names it.
//
// What that does NOT hide: whoever runs an add-in in their browser can read it, JS and WGSL alike (the developer
// tools show every module and every shader). An add-in is private from the public, not from its users.
//
// WHERE THE URLS COME FROM, in this order, each once:
//   1. addins.json beside app.html: a list of module URLs. This repository ships it empty; a private deploy writes
//      its own (docs/addins/template). Its entries are trusted: whoever can write a file on this origin can change
//      the page itself.
//   2. ?addins=<manifest url> and ?addin=<module url> in the address (each may repeat).
//   3. The user's own list (Help > Add-ins..., kept in localStorage).
//
// TRUST. The page keeps the user's projects in IndexedDB, and anything imported runs as the page. So a link carrying
// ?addin=https://elsewhere/x.js must not run that code on a click: an address's add-in loads without asking only from
// this origin or from the user's own machine (localhost, 127.0.0.1, [::1]). Anything else is asked first, and once
// allowed joins the user's list, from where it loads without asking.
//
// AN ADD-IN THAT FAILS -- a 404, a throw, a promise that never settles -- is said in the list and in the console, and
// the page goes on without it. A safe start (?safe, or a last start that never finished: start.js) loads none, since
// an add-in may be why the last one never finished.
//
// TWO PHASES, because the page has two moments an add-in needs (app.html):
//   register(st)  before the shell's layout is restored and its View entries made: a panel registered after the
//                 restore is left out of a saved layout (lib/shell/README.md), so panels and commands go here.
//   start(st)     once the page is up -- the renderer, the builder, the optics page and the first compile done.
// No DOM and no browser globals here: app.html hands in import(), fetch, confirm and localStorage, so
// lib/addins/test/loader.test.mjs runs all of it in node.
//======================================================================================================================
import { makeAddinApi } from './api.js'

/** The version of the contract an add-in is handed (api.js). An add-in names the one it was written for. */
export const ADDIN_API = 1
/** The user's own list in localStorage: [url, ...]. */
export const LIST_KEY = 'shadytracer.addins'
/** The manifest beside app.html. */
export const MANIFEST = 'addins.json'
/** What an add-in's id may be: it prefixes its panels, commands, settings and storage. */
export const ID_RE = /^[a-z][a-z0-9-]{0,39}$/

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Where a URL is, as the trust rule reads it: 'same' (this page's origin), 'local' (the user's machine), 'foreign',
 *  or 'bad' (not a URL, or not http(s)). */
export function trustOf(url, base) {
    let u, b
    try { u = new URL(url, base); b = new URL(base) } catch { return 'bad' }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'bad'
    if (u.origin === b.origin) return 'same'
    if (LOCAL_HOSTS.has(u.hostname)) return 'local'
    return 'foreign'
}

/** A manifest's text as a list of URLs, resolved against the manifest's own address: a JSON array of strings, or of
 *  { url }. Anything else throws, saying what it got. */
export function parseManifest(text, at) {
    let list
    try { list = JSON.parse(text) } catch (e) { throw new Error(`${at}: not JSON (${e.message})`) }
    if (!Array.isArray(list)) throw new Error(`${at}: a list of module URLs was expected`)
    return list.map((x, i) => {
        const url = typeof x === 'string' ? x : x?.url
        if (typeof url !== 'string' || !url) throw new Error(`${at}: entry ${i + 1} is not a URL`)
        return new URL(url, at).href
    })
}

/** The user's list, read: always an array of strings, [] for nothing or anything unreadable. */
export function readList(storage) {
    try {
        const v = JSON.parse(storage?.getItem(LIST_KEY) || '[]')
        return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []
    } catch { return [] }
}
const writeList = (storage, list) => { try { storage?.setItem(LIST_KEY, JSON.stringify(list)); return true } catch { return false } }

/** A promise that gives up after `ms`, saying what it was waiting for. The work itself cannot be stopped; it is only
 *  no longer waited on. */
const within = (p, ms, what) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${what}: no answer after ${ms / 1000} s`)), ms)
    Promise.resolve(p).then(v => { clearTimeout(t); res(v) }, e => { clearTimeout(t); rej(e) })
})

/** An add-in module's declaration checked: { id, name, api } or a throw saying what is wrong. */
export function declarationOf(mod, url) {
    const d = mod?.addin
    if (!d || typeof d !== 'object') throw new Error(`${url}: exports no \`addin\` ({ id, name, api })`)
    if (typeof d.id !== 'string' || !ID_RE.test(d.id)) throw new Error(`${url}: its id '${d.id}' must be lower case letters, digits and -, at most 40, a letter first`)
    if (d.api !== ADDIN_API) throw new Error(`${url}: written for add-in API ${d.api}, this page has ${ADDIN_API}`)
    if (typeof mod.register !== 'function' && typeof mod.start !== 'function') throw new Error(`${url}: exports neither register() nor start()`)
    return { id: d.id, name: typeof d.name === 'string' && d.name ? d.name : d.id, api: d.api, version: typeof d.version === 'string' ? d.version : '' }
}

/**
 * The page's add-ins.
 * @param base      the page's own address (location.href): what relative URLs and the trust rule are read against
 * @param search    location.search
 * @param storage   localStorage, or null
 * @param importer  url => import(url)
 * @param fetchText url => a promise of the text at url, or of null for none there (a 404)
 * @param confirm   message => a promise of true to load a foreign add-in from the address
 * @param safe      true for a safe start: nothing is loaded
 * @param log       (kind, text) => the console
 * @param timeoutMs how long an import, a register() and a start() are each waited for
 */
export function createAddins({ base, search = '', storage = null, importer, fetchText, confirm = async () => false,
                               safe = false, log = () => { }, timeoutMs = { load: 20000, register: 10000, start: 60000 } } = {}) {
    /** every add-in the page knows of, in load order: { url, from, state, error, id, name, version } -- state one of
     *  'waiting', 'refused', 'failed', 'registered', 'started' */
    const entries = []
    const mods = new Map()            // url -> { mod, st, decl }
    let host = null
    let phase = 'none'
    let starting = false

    const say = (kind, text) => { try { log(kind, `[add-ins] ${text}`) } catch { } }
    const fail = (e, error) => { e.state = 'failed'; e.error = String(error?.message ?? error); say('error', `${e.name ?? e.url}: ${e.error}`) }

    /* THE URLS, each once, the first source to name one keeping it (its `from` is what the list says) */
    async function gather() {
        const out = []
        const seen = new Set()
        const add = (url, from) => {
            let href
            try { href = new URL(url, base).href } catch { out.push({ url: String(url), from, state: 'refused', error: 'not a URL' }); return }
            if (seen.has(href)) return
            seen.add(href)
            out.push({ url: href, from, state: 'waiting', error: null })
        }
        const manifest = async (at, from) => {
            let text
            try { text = await fetchText(at) } catch (e) { say('warn', `${at}: ${e.message ?? e}`); return }
            if (text == null) return                         // none there: nothing to load
            try { for (const u of parseManifest(text, at)) add(u, from) }
            catch (e) { say('error', e.message) }
        }
        /* 1. beside the page */
        await manifest(new URL(MANIFEST, base).href, 'manifest')
        /* 2. the address: a manifest or a module from elsewhere asked first, and once allowed remembered */
        const q = new URLSearchParams(search)
        const asked = async (url, what) => {
            const t = trustOf(url, base)
            if (t === 'bad') { out.push({ url: String(url), from: 'address', state: 'refused', error: 'not an http(s) URL' }); return false }
            if (t !== 'foreign') return true
            const href = new URL(url, base).href
            if (readList(storage).includes(href)) return true
            const yes = await confirm(`Load the add-in ${what} ${href}?\n\nIt runs as this page does, with your projects. Load only code you trust.`)
            if (yes) writeList(storage, [...readList(storage), href])
            else out.push({ url: href, from: 'address', state: 'refused', error: 'not allowed' })
            return !!yes
        }
        for (const m of q.getAll('addins')) if (await asked(m, 'list')) await manifest(new URL(m, base).href, 'address')
        for (const u of q.getAll('addin')) if (await asked(u, 'module')) add(u, 'address')
        /* 3. the user's own */
        for (const u of readList(storage)) add(u, 'yours')
        return out
    }

    /** PHASE ONE: every add-in imported and its register(st) called, in order, one at a time (a panel's place in the
     *  View menu is its registration order). `h` is what the API is made of (api.js makeAddinApi). */
    async function register(h) {
        if (phase !== 'none') throw new Error('add-ins: register() runs once')
        phase = 'register'
        host = h
        if (safe) { say('warn', 'a safe start: no add-in loaded'); return list() }
        for (const e of await gather()) {
            entries.push(e)
            if (e.state !== 'waiting') continue
            let mod
            try { mod = await within(importer(e.url), timeoutMs.load, 'import') } catch (err) { fail(e, err); continue }
            let decl
            try { decl = declarationOf(mod, e.url) } catch (err) { e.state = 'refused'; e.error = err.message; say('error', err.message); continue }
            Object.assign(e, { id: decl.id, name: decl.name, version: decl.version })
            if ([...mods.values()].some(m => m.decl.id === decl.id)) { e.state = 'refused'; e.error = `another add-in has the id '${decl.id}'`; say('error', `${e.url}: ${e.error}`); continue }
            const st = makeAddinApi(decl, host)
            mods.set(e.url, { mod, st, decl })
            try { if (typeof mod.register === 'function') await within(mod.register(st), timeoutMs.register, 'register()') }
            catch (err) { fail(e, err); continue }
            e.state = 'registered'
        }
        phase = 'registered'
        return list()
    }

    /** PHASE TWO: start(st) for every add-in that registered, with the rest of the page (`late`: RT, BUILDER, ...)
     *  handed to their API. Each is waited on in turn, so one add-in's start sees the ones before it started. */
    async function start(late = {}) {
        if (phase !== 'registered' || starting) throw new Error('add-ins: start() runs once, after register()')
        starting = true
        Object.assign(host, late, { started: true })
        for (const e of entries) {
            if (e.state !== 'registered') continue
            const { mod, st } = mods.get(e.url)
            try { if (typeof mod.start === 'function') await within(mod.start(st), timeoutMs.start, 'start()') }
            catch (err) { fail(e, err); continue }
            e.state = 'started'
        }
        phase = 'started'
        return list()
    }

    /** What the page loaded and how it went: copies, for a panel to show. */
    const list = () => entries.map(e => ({ ...e }))

    return {
        register, start, list,
        get phase() { return phase },
        get safe() { return safe },
        /** The user's own list: what Help > Add-ins... shows and changes. A change takes effect at the next load: a
         *  module cannot be unloaded from a page. */
        yours: () => readList(storage),
        add(url) {
            const t = trustOf(url, base)
            if (t === 'bad') throw new Error(`'${url}' is not an http(s) URL`)
            const href = new URL(url, base).href
            const l = readList(storage)
            if (!l.includes(href)) { l.push(href); if (!writeList(storage, l)) throw new Error('this browser keeps nothing (storage is off)') }
            return href
        },
        remove(url) {
            const l = readList(storage), i = l.indexOf(url)
            if (i < 0) return false
            l.splice(i, 1)
            return writeList(storage, l)
        },
    }
}
