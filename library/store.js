//======================================================================================================================
// THE LIBRARY -- things to put into a scene: objects, groups, lights and materials, built in and the user's own.
//
// AN ITEM IS AN ASSET (builder/model.js extractAsset) WITH A NAME. The model's own JSON, a node with the
// materials it uses and the unit its numbers are in, or a material -- so inserting one is exactly a
// paste (insertAsset: fresh ids, its materials reused where the scene has the same, its size kept across
// units), and anything in a scene can become an item by copying it out.
//
//   { id, name, kind: 'object' | 'group' | 'light' | 'material', category, tags: [], help, source, asset }
//
// TAGS are words, lower case, each once (normalTags): what the panel's tag row filters by, several at once
// meaning all of them. A category is where an item is LISTED, a tag what it can be FOUND by; one's own item
// in a built-in category is listed with the built-in ones (after them), not under a second heading.
//
// WHERE THEY COME FROM (UI_PLAN.md section 7):
//   built in   what the + menu offers, made here from the same tables it reads (primitives.js,
//              modifiers.js, lights.js, materials.js PRESETS) so the two cannot drift; and assemblies
//              kept as files in library/items/ (a lens, an LED, the optics test's bench), listed in
//              library/items/index.js
//   mine       the user's, in the browser's IndexedDB -- as ray files are -- through `backend`, which a
//              test replaces with memory
//   a file     a library exported and imported, to share between people or machines (exportLibrary /
//              importLibrary): the user's items with it, as new ones
//
//   const L = createLibrary({ model, backend })   await L.list()   L.search(items, 'lens', { kind, source, tags })
//   await L.add({ name, category, tags, help, asset })   await L.remove(id)   await L.rename(id, name)
//   await L.update(id, { name, category, tags, help, asset })   await L.duplicate(id) -> one's own copy
//   tagCounts(items) -> [[tag, n], ...], the most used first
//======================================================================================================================
/* global indexedDB -- the browser's, used only by indexedDbBackend (a test passes memoryBackend) */
import { PRIMITIVES, primitiveObject, shapeTags } from '../builder/primitives.js'
import { MODIFIERS, modifierGroup } from '../builder/modifiers.js'
import { LIGHT_SHAPES } from '../builder/lights.js'
import { PRESETS } from '../builder/materials.js'
import { stamp } from '../version.js'

export const KINDS = ['object', 'group', 'light', 'material']

/** Tags as the library keeps them: words, trimmed, lower case, each once -- from a list or a line of text
 *  ("metal, Brushed , metal" is ['metal', 'brushed']). The file of built-in materials had "metal" twice. */
export const normalTags = tags => [...new Set((Array.isArray(tags) ? tags : String(tags ?? '').split(','))
    .map(t => String(t ?? '').trim().toLowerCase()).filter(Boolean))]
/* 2: an item's asset carries the BLOCKS its nodes use (scene format 16, model.js extractAsset): its nodes hold no code of
   their own. A program that reads version 1 would put such an item in as code nodes with no code, so it is told this
   file is newer than it reads instead. Version 1 files are read as they are: their nodes' code becomes blocks as they
   go into a scene (insertAsset). */
export const FORMAT = 'raytracer-library', VERSION = 2

/** What kind of item an asset is: a material, or a node's own kind (a light is an object of type light). */
export const kindOf = asset => asset?.kind === 'material' ? 'material'
    : asset?.node?.kind === 'group' ? 'group' : asset?.node?.type === 'light' ? 'light' : 'object'

/* THE + MENU'S ENTRIES AS ITEMS: each made in a scratch document by the same calls the menu makes, then
   copied out -- so a built-in sphere is what + sphere would have made, whatever primitives.js says next.
   A shape, a modifier or a light from here has NO SIZE OF ITS OWN (unit null, model.js insertAsset): it
   lands at 1 unit of the scene it goes into, as + makes it there. An LED or a lens has a real size and
   keeps it; a material has nothing to convert. */
function menuItems(model) {
    const items = []
    const make = (id, name, category, help, fn) => {
        const doc = model.createDoc({ title: 'library' })
        const made = fn(doc)
        const asset = model.extractAsset(doc, made.id)
        if (asset.kind === 'node') asset.unit = null
        items.push({ id: `builtin:${id}`, name, category, tags: [], help, source: 'built-in', asset })
    }
    for (const k of Object.keys(PRIMITIVES)) {
        make(`shape:${k}`, k, 'Shapes', `${/^[aeiou]/.test(k) ? 'An' : 'A'} ${k}: a code node whose code and parameters are yours to change.`,
            doc => model.addObject(doc, 'root', primitiveObject(k)))
        // its group as a tag -- primitives, optics, from points (primitives.js SHAPE_GROUPS) -- for the tag row to filter by
        items.at(-1).tags = normalTags(shapeTags(k))
    }
    for (const [k, m] of Object.entries(MODIFIERS)) {
        make(`modifier:${k}`, m.label, 'Modifiers', `A group that ${m.label}s what is put in it.`,
            doc => model.addGroup(doc, 'root', modifierGroup(k)))
        // what kind of modifier it is -- space, shape or surface -- is the modifier's own to say
        items.at(-1).tags = normalTags(m.tags)
    }
    for (const [k, s] of Object.entries(LIGHT_SHAPES))
        make(`light:${k}`, s.label, 'Lights', k === 'rayfile' ? 'A light from a Zemax ray file: choose the file in its properties.'
            : `A ${k} light: its size, its flux or luminance, its distribution and colour are its properties.`,
            doc => model.addLight(doc, 'root', { shape: k }))
    for (const [k, p] of Object.entries(PRESETS))
        make(`material:${k}`, p.label, 'Materials', `A ${p.label} material.`, doc => model.addMaterial(doc, { preset: k }))
    for (const it of items) it.kind = kindOf(it.asset)
    return items
}

/* THE ASSEMBLIES shipped as files (library/items/): each file one item, or { items: [...] } */
async function fileItems(files, load) {
    const out = []
    for (const f of files) {
        try {
            const j = await load(f)
            for (const [i, it] of (Array.isArray(j.items) ? j.items : [j]).entries())
                out.push({ help: '', category: 'Assemblies', ...it, tags: normalTags(it.tags), id: `builtin:file:${f}:${i}`, source: 'built-in', kind: kindOf(it.asset) })
        } catch (e) { console.warn(`[library] ${f} did not load:`, e?.message) }
    }
    return out
}

/** Is this something the library can hold: an asset of a kind it knows, with a name? Says why not. */
export function problemOf(item) {
    if (!item || typeof item !== 'object') return 'not an item'
    if (!item.name || typeof item.name !== 'string') return 'no name'
    const a = item.asset
    // a material's sample (what it is pictured on): a node asset, when it has one of its own
    if (item.preview != null && !(item.preview.kind === 'node' && item.preview.node && typeof item.preview.node === 'object'))
        return 'a preview that is not a node asset'
    if (a?.kind === 'material') return a.material && typeof a.material === 'object' ? null : 'a material asset without its material'
    if (a?.kind === 'node') return a.node && typeof a.node === 'object' && a.node.kind ? null : 'a node asset without its node'
    return 'no asset (a node or a material)'
}

/** Items matching a query -- every word somewhere in the name, category, tags or help -- and the filters;
 *  `tags` must ALL be the item's (several lit in the panel narrow, as the words do). */
export function search(items, query = '', { kind = null, source = null, tags = [] } = {}) {
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean)
    return items.filter(it => (!kind || it.kind === kind) && (!source || it.source === source)
        && tags.every(t => (it.tags || []).includes(t)) && words.every(w =>
        [it.name, it.category, it.help, ...(it.tags || [])].some(s => String(s ?? '').toLowerCase().includes(w))))
}

/** Every tag of these items and how many carry it, the most used first (then by name): the panel's tag row. */
export function tagCounts(items) {
    const n = new Map()
    for (const it of items) for (const t of new Set(it.tags || [])) n.set(t, (n.get(t) || 0) + 1)
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** THE USER'S ITEMS IN INDEXEDDB: the browser's own, kept between visits (optics/rayfiles.js does the same). */
export function indexedDbBackend(name = 'raytracer.library', store = 'items') {
    const db = () => new Promise((res, rej) => {
        const r = indexedDB.open(name, 1)
        r.onupgradeneeded = () => r.result.createObjectStore(store, { keyPath: 'id' })
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
    })
    const run = async (mode, fn) => {
        const d = await db()
        return new Promise((res, rej) => {
            const t = d.transaction(store, mode)
            const q = fn(t.objectStore(store))
            t.oncomplete = () => res(q?.result)
            t.onerror = () => rej(t.error)
        })
    }
    return {
        all: () => run('readonly', s => s.getAll()).then(v => v ?? []),
        put: item => run('readwrite', s => s.put(item)),
        delete: id => run('readwrite', s => s.delete(id)),
    }
}
/** The same in memory: for a test, or a browser that refuses storage (the items last the visit). */
export function memoryBackend(initial = []) {
    const m = new Map(initial.map(i => [i.id, structuredClone(i)]))
    return { all: async () => [...m.values()].map(i => structuredClone(i)), put: async i => { m.set(i.id, structuredClone(i)) },
             delete: async id => { m.delete(id) } }
}

/**
 * @param model    builder/model.js (createDoc, addObject, addGroup, addLight, addMaterial, extractAsset)
 * @param backend  where the user's items live (indexedDbBackend(), memoryBackend())
 * @param files    the assemblies' files (library/items/index.js ITEM_FILES), and `load(file)` to read one
 */
export function createLibrary({ model, backend = memoryBackend(), files = [], load = null } = {}) {
    let builtIns = null
    const listeners = new Set()
    const changed = () => { for (const f of listeners) { try { f() } catch (e) { console.error('[library]', e) } } }
    const newId = () => `mine:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    const L = {
        /** Every item: the built-in ones, then the user's, each list by category and name. */
        async list() {
            /* ONE HEADING PER CATEGORY: the files' items join the menu's under the same category (an
               LED under Lights, beside the light shapes), categories in the order they first appear */
            if (!builtIns) {
                const all = [...menuItems(model), ...(load ? await fileItems(files, load) : [])]
                const rank = new Map()
                for (const it of all) if (!rank.has(it.category)) rank.set(it.category, rank.size)
                builtIns = all.map((it, i) => ({ it, i })).sort((a, b) => rank.get(a.it.category) - rank.get(b.it.category) || a.i - b.i).map(x => x.it)
            }
            let mine = []
            try { mine = (await backend.all()).map(i => ({ ...i, source: 'mine', kind: kindOf(i.asset) })) }
            catch (e) { console.warn('[library] your items could not be read:', e?.message) }
            /* ONE'S OWN WITH THE BUILT-IN ONES OF THEIR CATEGORY, after them: a duplicated material listed
               under a second "Materials" heading at the bottom looked like another category. Categories
               only one's own items have come last, by name. */
            const by = (a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name))
            mine.sort(by)
            const cats = [...new Set(builtIns.map(i => i.category))]
            const out = []
            for (const c of cats) out.push(...builtIns.filter(i => i.category === c), ...mine.filter(i => i.category === c))
            return [...out, ...mine.filter(i => !cats.includes(i.category))]
        },
        search, tagCounts,
        /** Keep an asset as one of the user's items. Returns the item. */
        async add({ name, category = 'Mine', tags = [], help = '', asset, preview }) {
            const item = { id: newId(), name: String(name ?? '').trim(), category: String(category || 'Mine').trim(), tags: normalTags(tags),
                           help: String(help ?? ''), asset: structuredClone(asset) }
            if (preview != null) item.preview = structuredClone(preview)
            const why = problemOf(item)
            if (why) throw new Error(`not added to the library: ${why}`)
            await backend.put(item)
            changed()
            return { ...item, source: 'mine', kind: kindOf(item.asset) }
        },
        async remove(id) {
            if (!String(id).startsWith('mine:')) throw new Error('a built-in item cannot be removed')
            await backend.delete(id); changed()
        },
        async rename(id, name) { return L.update(id, { name }) },
        /** Change one of the user's items: any of name, category, tags, help, asset, preview (null takes a
         *  preview away). Checked as add() checks; returns the item. A built-in item is not the user's to
         *  change -- duplicate() it first. */
        async update(id, patch = {}) {
            if (!String(id).startsWith('mine:')) throw new Error('a built-in item cannot be changed: duplicate it first')
            const it = (await backend.all()).find(i => i.id === id)
            if (!it) throw new Error('no such item of yours')
            const next = { ...it }
            if ('name' in patch) next.name = String(patch.name ?? '').trim() || it.name
            if ('category' in patch) next.category = String(patch.category ?? '').trim() || 'Mine'
            if ('tags' in patch) next.tags = normalTags(patch.tags)
            if ('help' in patch) next.help = String(patch.help ?? '')
            if ('asset' in patch) next.asset = structuredClone(patch.asset)
            if ('preview' in patch) { if (patch.preview == null) delete next.preview; else next.preview = structuredClone(patch.preview) }
            const why = problemOf(next)
            if (why) throw new Error(`not changed: ${why}`)
            await backend.put(next); changed()
            return { ...next, source: 'mine', kind: kindOf(next.asset) }
        },
        /** A copy of any item, built in or the user's, as one of the user's: its category, tags and help
         *  with it, named "... copy". How a built-in item becomes one to edit. */
        async duplicate(id, { name } = {}) {
            const it = (await L.list()).find(i => i.id === id)
            if (!it) throw new Error('no such item')
            return L.add({ name: name ?? `${it.name} copy`, category: it.category, tags: it.tags, help: it.help,
                           asset: it.asset, preview: it.preview })
        },
        /** Be told when the user's items change (a panel redraws). */
        on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
        /** The user's items as a file's text (built-in ones ship with the program and are left out). */
        async exportLibrary() {
            const items = (await backend.all()).map(({ source: _s, kind: _k, ...i }) => i)
            // `app`: which version of the application wrote the file (version.js); import reads only `items`
            return JSON.stringify({ format: FORMAT, version: VERSION, app: stamp(), items }, null, 1)
        },
        /** A file's items, added as new ones of the user's (a second import of the same file adds them
         *  again, as a paste would). Returns { added, skipped: [{ name, why }] }. */
        async importLibrary(text) {
            let j
            try { j = JSON.parse(text) } catch { throw new Error('not a library file (not JSON)') }
            if (j?.format !== FORMAT) throw new Error(`not a library file (format '${j?.format ?? 'none'}')`)
            if (!(j.version <= VERSION)) throw new Error(`a newer library file (version ${j.version}) than this program reads (${VERSION})`)
            const added = [], skipped = []
            for (const it of j.items || []) {
                const why = problemOf(it)
                if (why) { skipped.push({ name: it?.name ?? '?', why }); continue }
                const item = { ...it, id: newId(), tags: normalTags(it.tags) }
                await backend.put(item)
                added.push(item)
            }
            if (added.length) changed()
            return { added: added.length, skipped }
        },
    }
    return L
}
