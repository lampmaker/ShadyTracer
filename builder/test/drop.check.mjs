// node builder/test/drop.check.mjs
//
// A LIBRARY ITEM DROPPED ON THE TREE (builder/tree.js dropAsset, acceptLibrary), headless, over the real
// tree, model and project with a stand-in builder: a material dropped on an object is used by it, on a
// group the group's, worn by every object in it but its light (0.76.0), and one then dropped on an object in it that
// object's own; a node dropped on an object goes in after it, on a group into
// it; a node dropped on the picture stands on the point hit (the host picks it; given here); a drop through
// the DOM -- dragover, drop on a row -- takes the same path; and a drag the tree did not start from the
// library is left alone. What the picture shows after is the user's to judge.
//
// OPTIONAL, AND LOUD ABOUT IT, as lib/shell/test/example.check.mjs is: it needs Playwright's Chromium.
/* global CHECK, DragEvent, DataTransfer -- the page's, in the evaluated functions */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
let chromium
try { ({ chromium } = await import('playwright')) } catch {
    try { ({ chromium } = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs')).href)) } catch { }
}
if (!chromium) { console.log('(drop check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = createServer(async (req, res) => {
    try {
        const path = join(repo, decodeURIComponent(new URL(req.url, 'http://x').pathname))
        if (!path.startsWith(repo)) throw new Error('outside')
        res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
        res.end(await readFile(path))
    } catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(0, r))
const b = await chromium.launch({ args: ['--disable-gpu'] })
const ctx = await b.newContext({ acceptDownloads: true })
const p = await ctx.newPage()
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
await p.goto(`http://localhost:${server.address().port}/builder/test/drop.html`)
await p.waitForFunction(() => window.CHECK && document.querySelectorAll('[data-path]').length > 0, null, { timeout: 5000 })

// A MATERIAL ON AN OBJECT, and ON A GROUP
let r = await p.evaluate(() => {
    const { M, tree, BUILDER, material } = CHECK
    tree.dropAsset(material, { mid: 'a' })
    const d = BUILDER.doc, m = M.material(d, M.find(d, 'a').node.material)
    return { label: m?.label, metallic: m?.params.metallic, b: M.find(d, 'b').node.material }
})
ok('a material dropped on an object is used by it', r.label === 'gold' && r.metallic > 0.5, JSON.stringify(r))
ok('...and by nothing else', r.b == null, JSON.stringify(r))
/* ON A GROUP (0.76.0, model.js version 23): the group's material, which every object in it wears over its own --
   their own kept underneath -- and one dropped on an object in it then that object's own, the others still the group's */
r = await p.evaluate(() => {
    const { M, tree, BUILDER, material } = CHECK
    const d0 = BUILDER.doc, before = M.find(d0, 'g1').node.material
    tree.dropAsset(material, { mid: 'g' })
    const d = BUILDER.doc, lab = id => M.material(d, M.wornMaterial(d, id).material)?.label ?? null
    return { g: M.material(d, M.find(d, 'g').node.material)?.label, same: M.find(d, 'g').node.material === M.find(d, 'a').node.material,
             g1: lab('g1'), g2: lab('g2'), from: M.wornMaterial(d, 'g1').group, kept: M.find(d, 'g1').node.material === before,
             light: M.find(d, 'gl').node.material }
})
ok('on a group, the group\'s -- the same gold, not a copy of it', r.g === 'gold' && r.same, JSON.stringify(r))
ok('...worn by every object in it, their own kept under it', r.g1 === 'gold' && r.g2 === 'gold' && r.from === 'g' && r.kept, JSON.stringify(r))
ok('...but not its light (a light has its own)', r.light == null, JSON.stringify(r))
r = await p.evaluate(() => {
    const { M, tree, BUILDER, material } = CHECK
    tree.dropAsset({ ...material, material: { ...material.material, label: 'red', params: { ...material.material.params, baseColor: { r: 1, g: 0, b: 0 } } } }, { mid: 'g1' })
    const d = BUILDER.doc, lab = id => M.material(d, M.wornMaterial(d, id).material)?.label ?? null
    return { g1: lab('g1'), own: M.find(d, 'g1').node.ownMaterial, g2: lab('g2') }
})
ok('then one dropped on an object in it: that object\'s own, kept over the group\'s', /^red/.test(r.g1) && r.own === true, JSON.stringify(r))
ok('...and the others still the group\'s', r.g2 === 'gold', JSON.stringify(r))

// A NODE ON AN OBJECT, ON A GROUP, ON THE PICTURE
r = await p.evaluate(() => {
    const { M, tree, BUILDER, node } = CHECK
    const after = tree.dropAsset(node, { mid: 'a' })
    const into = tree.dropAsset(node, { mid: 'g' })
    const onPic = tree.dropAsset(node, { pos: [2, 3, 1] })
    const d = BUILDER.doc
    const ids = d.root.children.map(c => c.id)
    return { ids, after: after?.id, afterAt: ids.indexOf(after?.id), aAt: ids.indexOf('a'),
             inG: M.find(d, 'g').node.children.some(c => c.id === into?.id),
             pos: onPic?.transform.pos, size: onPic?.params.size, sel: CHECK.T.status, afterMat: after?.material }
})
ok('a node dropped on an object goes in right after it', r.afterAt === r.aAt + 1, JSON.stringify(r))
ok('on a group, into it', r.inG, JSON.stringify(r))
// a copy of the user's (a metre-scene node, material none) keeps none -- it is theirs as it was
ok('a node of the user\'s keeps its "no material"', r.afterMat === null, JSON.stringify(r))
// the cube's half-size is 0.5: standing on z = 1 its centre is at 1.5, over the point
ok('on the picture, standing on the point hit', r.pos && Math.abs(r.pos.x - 2) < 1e-9 && Math.abs(r.pos.y - 3) < 1e-9 && Math.abs(r.pos.z - 1.5) < 1e-6, JSON.stringify(r.pos))

// A SHAPE OF NO SIZE OF ITS OWN (a generic library shape, unit null) wears the scene's default, as + makes it
r = await p.evaluate(() => {
    const { M, tree, BUILDER, node } = CHECK
    const n = tree.dropAsset({ ...node, unit: null }, { mid: 'g' })
    return { mat: n?.material, dflt: M.defaultMaterial(BUILDER.doc)?.id }
})
ok('a generic library shape wears the scene\'s default material', r.mat === 'red' && r.dflt === 'red', JSON.stringify(r))

// + ON THE SCENE, through the widget's menu: a new shape wears the default (the first surface in the list). The
// scene's row is the root again since 0.26.0 (tree.js rowsFor), its + the widget's as a group's is
r = await p.evaluate(async () => {
    const { M, BUILDER } = CHECK
    const sceneRow = document.querySelector('[data-path="0"]')
    sceneRow.querySelector('[title="Add…"]').click()
    const item = label => [...document.querySelectorAll('.treeview-child-type-menu div')].find(e => e.textContent.trim().startsWith(label))
    item('Shapes').click()
    item('Primitives').click()            // the shapes in their groups since 2026-10-01 (primitives.js SHAPE_GROUPS)
    item('sphere').click()
    const d = BUILDER.doc, n = d.root.children.at(-1)
    const lab = [...document.querySelectorAll('[data-path]')].map(e => e.textContent.trim()).find(t => t.startsWith('red'))
    return { label: n.label, mat: n.material, row: lab }
})
ok('+ sphere wears the scene\'s default material', r.mat === 'red' && r.label === 'sphere', JSON.stringify(r))
ok('...and the Materials row says which is the default', /red\s+· default/.test(r.row ?? ''), JSON.stringify(r))

// THROUGH THE DOM: dragover and drop on a row, as the browser sends them
r = await p.evaluate(() => {
    const { M, BUILDER, material } = CHECK
    const row = [...document.querySelectorAll('[data-path]')].filter(e => e.textContent.includes('bee')).at(-1)
    const fire = (type, target) => { const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }); target.dispatchEvent(e); return e }
    CHECK.setDragged(null)
    const ignored = !fire('dragover', row).defaultPrevented       // not a library drag: the widget's own business
    CHECK.setDragged({ name: 'gold', asset: material })
    const over = fire('dragover', row)
    const marked = document.querySelector('.shell-drop-target') != null
    fire('drop', row)
    CHECK.setDragged(null)
    const d = BUILDER.doc
    return { ignored, accepted: over.defaultPrevented, marked, cleared: !document.querySelector('.shell-drop-target'),
             text: row.textContent.trim().slice(0, 40), b: M.material(d, M.find(d, 'b').node.material)?.label ?? null }
})
ok('a drag the library did not start is left to the widget', r.ignored, JSON.stringify(r))
ok('a library drag over a row is accepted and the row marked', r.accepted && r.marked, JSON.stringify(r))
ok('dropped on the row: the material is on that object, and the mark gone', r.b === 'gold' && r.cleared, JSON.stringify(r))

/* A MATERIAL ROW OF THE TREE ITSELF dragged onto a shape's or a group's row (0.76.0, tree.js wear): TreeView keeps a
   material row among Materials, so the tree lets the drop through and takes it -- as a Library material dropped there */
const rowDrag = (from, to) => p.evaluate(([from, to]) => {
    const { M, BUILDER } = CHECK
    const rowOf = text => [...document.querySelectorAll('[data-path]')].find(e => e.textContent.trim().startsWith(text))
    const fire = (type, target, dt) => { const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }); target.dispatchEvent(e); return e }
    const dt = new DataTransfer(), src = rowOf(from), dst = rowOf(to)
    if (!src || !dst) return { error: `no row '${src ? to : from}'` }
    fire('dragstart', src, dt)
    const over = fire('dragover', dst, dt)
    const marked = dst.classList.contains('shell-drop-target')
    fire('drop', dst, dt)
    fire('dragend', src, dt)
    const d = BUILDER.doc, lab = id => M.material(d, M.wornMaterial(d, id).material)?.label ?? null
    return { accepted: over.defaultPrevented, marked, cleared: !document.querySelector('.shell-drop-target'), materials: d.materials.length,
             b: lab('b'), g: M.material(d, M.find(d, 'g').node.material)?.label ?? null, g2: lab('g2'), status: CHECK.T.status.at(-1) }
}, [from, to])
const n0 = await p.evaluate(() => CHECK.BUILDER.doc.materials.length)
r = await rowDrag('red', 'bee')
ok('a material row of the tree dragged over a shape\'s row: let through, the row marked', r.accepted && r.marked, JSON.stringify(r))
ok('...dropped: worn by it, no material added, the mark gone', r.b === 'red' && r.materials === n0 && r.cleared && r.status !== 'cannot drop there', JSON.stringify(r))
r = await rowDrag('red', 'group')
ok('...on a group\'s row: the group\'s, worn by what is in it', r.g === 'red' && r.g2 === 'red', JSON.stringify(r))
r = await p.evaluate(() => {
    const row = [...document.querySelectorAll('[data-path]')].find(e => e.textContent.trim().startsWith('red'))
    const e = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })
    row.dispatchEvent(e)
    return { marked: row.classList.contains('shell-drop-target') }
})
ok('...and with nothing dragged, a row is left alone', !r.marked, JSON.stringify(r))

if (errs.length) failed++
console.log(errs.join('\n') || 'no page errors'); await b.close(); server.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
