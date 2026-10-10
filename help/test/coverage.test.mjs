// node help/test/coverage.test.mjs
//
// THE HELP HOLDS TOGETHER, no DOM:
//   - every page the contents list (help/index.js) names is a file, with the title the list gives it as its first
//     heading, and every markdown file under help/ is in the list -- a page written and not listed is never read;
//   - every link in every page goes somewhere: a page that exists (and its heading, for an anchor), an example
//     File › Examples has, a command the page registers, a panel or menu that exists, a widget that exists;
//   - the reference pages are what help/reference.mjs writes now -- so a shape, modifier, material field or light
//     setting added to the program changes them, and they are made again with it -- and every material field and
//     light setting has its words (reference.mjs FIELD_HELP, LIGHT_HELP).
// The commands and panels are read from the page's source (index.html and the modules that register them), as
// check-shaders reads the page's inline script: there is no running page here.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HELP, PAGES, HOME } from '../index.js'
import { renderMarkdown } from '../markdown.js'
import { kindOf, linksIn } from '../links.js'
import { WIDGETS } from '../widgets.js'
import { referencePages, FIELD_HELP, LIGHT_HELP } from '../reference.mjs'
import { EXAMPLES } from '../../scenes/index.js'
import { FIELDS } from '../../builder/materials.js'
import { LIGHT_DEFAULTS } from '../../builder/lights.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const help = fileURLToPath(new URL('../', import.meta.url))
const repo = fileURLToPath(new URL('../../', import.meta.url))
const read = f => readFileSync(join(help, f), 'utf8')

// ---- the contents and the files
const ids = PAGES.map(p => p.id), files = PAGES.map(p => p.file)
ok('page ids and files are each listed once', new Set(ids).size === ids.length && new Set(files).size === files.length)
ok('the first page is a page', PAGES.some(p => p.id === HOME))
ok('every track has a name', HELP.every(t => t.track))
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'test' ? [] : walk(p)) : [p] })
const onDisk = walk(help).filter(f => f.endsWith('.md') && !f.endsWith('README.md')).map(f => relative(help, f).split('\\').join('/'))
ok('every page under help/ is in the contents', onDisk.every(f => files.includes(f)), onDisk.filter(f => !files.includes(f)).join(', '))
const parsed = new Map()
for (const p of PAGES) {
    if (!existsSync(join(help, p.file))) { ok(`${p.file} exists`, false); continue }
    const r = renderMarkdown(read(p.file))
    parsed.set(p.file, r)
    ok(`${p.file}: its first heading is the contents' title`, r.title === p.title, `"${r.title}" against "${p.title}"`)
}

// ---- what a link can name: commands and panels as the page's source registers them
const source = ['index.html', 'builder/filemenu.js', 'lib/shell/shell.js'].map(f => readFileSync(join(repo, f), 'utf8')).join('\n')
const commands = new Set([...source.matchAll(/(?:\bC|command|add|SHELL\.command)\(\{\s*id:\s*[`'"]([\w.]+)[`'"]/g)].map(m => m[1]))
const panels = new Set([...source.matchAll(/SHELL\.panel\(\{\s*id:\s*'([\w.]+)'/g)].map(m => m[1]))
const menus = new Set(JSON.parse(/menus:\s*(\[[^\]]*\])/.exec(readFileSync(join(repo, 'index.html'), 'utf8'))[1].replace(/'/g, '"')))
ok('the page\'s commands, panels and menus were found to check against', commands.has('help.contents') && panels.has('properties') && menus.has('Analysis'),
    JSON.stringify({ commands: commands.size, panels: [...panels], menus: [...menus] }))
const examples = new Set(EXAMPLES.map(e => e.file))
for (const p of PAGES) {
    const r = parsed.get(p.file)
    if (!r) continue
    const bad = []
    for (const { href, line, image } of linksIn(read(p.file))) {
        if (image) { if (!/^https?:/.test(href) && !existsSync(join(help, p.file, '..', href))) bad.push(`line ${line}: no picture ${href}`); continue }
        const k = kindOf(href, p.file)
        const target = k.kind === 'page' ? PAGES.find(x => k.byId ? x.id === k.target : x.file === k.target) : null
        if (k.kind === null) bad.push(`line ${line}: a link the panel does not follow: ${href}`)
        else if (k.kind === 'page' && !target) bad.push(`line ${line}: no page ${href}`)
        else if (k.kind === 'page' && k.anchor && parsed.get(target.file) && !parsed.get(target.file).headings.some(h => h.id === k.anchor))
            bad.push(`line ${line}: no heading #${k.anchor} in ${target.file}`)
        else if (k.kind === 'anchor' && !r.headings.some(h => h.id === k.target)) bad.push(`line ${line}: no heading #${k.target}`)
        else if (k.kind === 'example' && !examples.has(k.target)) bad.push(`line ${line}: no example ${k.target}`)
        else if (k.kind === 'cmd' && !commands.has(k.target)) bad.push(`line ${line}: no command ${k.target}`)
        else if (k.kind === 'show' && !(k.target.startsWith('menu:') ? menus.has(k.target.slice(5)) : panels.has(k.target))) bad.push(`line ${line}: nothing called ${k.target}`)
    }
    for (const w of r.widgets) if (!WIDGETS[w.name]) bad.push(`no widget '${w.name}'`)
    ok(`${p.file}: every link and widget goes somewhere`, !bad.length, bad.join('\n      '))
}

// ---- the reference, made from the program's lists
for (const [file, text] of Object.entries(referencePages()))
    ok(`${file} is what help/reference.mjs writes now (node help/reference.mjs makes it again)`, existsSync(join(help, file)) && read(file) === text)
ok('every material field has its words', Object.keys(FIELDS).every(k => FIELD_HELP[k]), Object.keys(FIELDS).filter(k => !FIELD_HELP[k]).join(', '))
ok('...and no words for a field there is not', Object.keys(FIELD_HELP).every(k => k in FIELDS), Object.keys(FIELD_HELP).filter(k => !(k in FIELDS)).join(', '))
ok('every light setting has its words', Object.keys(LIGHT_DEFAULTS).every(k => LIGHT_HELP[k]), Object.keys(LIGHT_DEFAULTS).filter(k => !LIGHT_HELP[k]).join(', '))
ok('...and no words for a setting there is not', Object.keys(LIGHT_HELP).every(k => k in LIGHT_DEFAULTS))
ok('every shape and modifier\'s reference entry has text (its code\'s first comment)', !/###? [^\n]+\n\n\n/.test(read('reference/shapes.md') + read('reference/modifiers.md')))

console.log(`help coverage: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
