//======================================================================================================================
// THE INSERT PANE UNDER A CODE BOX (0.next): builder/coderef.js shown where the code is written -- for a block of each
// kind, what it can set (a material's every field, as the line that sets it, from the material's own values), what it
// reads, recipes, the functions it reaches for, and what it cannot do. A click puts the line in the code at the caret;
// a search finds a row by any word it shows. The user, 2026-11-07: "there is no explanation / tool to easily pick the
// parameters you want to change, or can change ... think of a way that makes it much easier."
//
//   const H = codeHelper({ kind, values, params, insert, open, onFold })   // H.el, H.find(words), H.rows()
//
// kind     'material' | 'relief' | 'object' | 'group' | 'functions'
// values   () => the material's params (its Set lines are written from them), or nothing
// params   () => [{ name, type, text }]: the block's own parameters, read by their names
// insert   (text, { line }) => put text in the code: `line` a whole line (or lines), else at the caret
//
// INLINE STYLES, NO STYLESHEET: the panel can be popped out into another window (popout.html), where a sheet this page's
// head carries does not reach.
//======================================================================================================================
import { CODE_BLOCKS, CODE_HELP, CODE_MADE, FIELD_HELP, preludeSignatures, typeWords, setsOf, cannotOf, recipeText, callOf } from './coderef.js'

const el = (tag, style, text) => {
    const e = document.createElement(tag)
    if (style) Object.assign(e.style, style)
    if (text != null) e.textContent = text
    return e
}
const MONO = { font: '11px/1.35 monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
const ROW = { padding: '3px 6px', borderRadius: '3px', cursor: 'pointer', margin: '1px 0' }
const WORDS = { font: '11px/1.35 sans-serif', opacity: '0.75', whiteSpace: 'normal' }
/** `code` in a sentence as code, the rest as text (ours, but put in as text, never HTML) */
const sentence = (s, style = WORDS) => {
    const d = el('div', style)
    String(s).split(/(`[^`]+`)/).forEach(part => {
        if (/^`[^`]+`$/.test(part)) d.append(el('code', { font: '11px monospace' }, part.slice(1, -1)))
        else if (part) d.append(document.createTextNode(part))
    })
    return d
}

let SIGS = null
const sigs = () => (SIGS ??= preludeSignatures())

export function codeHelper({ kind = 'object', values = () => null, params = () => [], insert = () => { }, open = false, onFold = () => { } } = {}) {
    const B = CODE_BLOCKS[kind] ?? CODE_BLOCKS.object
    const root = el('details', { margin: '2px 4px 6px', borderRadius: '3px', background: 'rgba(127,127,127,0.08)' })
    root.className = 'rt-code-insert'
    root.open = !!open
    const head = el('summary', { cursor: 'pointer', padding: '4px 6px', font: '12px sans-serif', userSelect: 'none' },
        'Insert: what this code can set, read and call')
    head.title = `${B.label[0].toUpperCase()}${B.label.slice(1)} runs ${B.runs}. Click a row to put it in the code at the caret.`
    const body = el('div', { padding: '0 4px 4px' })
    const q = el('input', { width: '100%', boxSizing: 'border-box', margin: '2px 0 4px', font: '12px sans-serif' })
    q.type = 'search'; q.placeholder = 'Find: roughness, coating, noise…'
    for (const k of ['keydown', 'keyup', 'keypress']) q.addEventListener(k, e => e.stopPropagation())
    const note = sentence(`Runs ${B.runs}. Click a row: it goes in at the caret.`, { ...WORDS, margin: '0 2px 4px' })
    const list = el('div')
    const none = el('div', { ...WORDS, padding: '4px 6px' }, 'Nothing matches.')
    body.append(q, note, list, none)
    root.append(head, body)
    root.addEventListener('toggle', () => { onFold(root.open); if (root.open) build() })

    /* BUILT WHEN OPENED, AND AGAIN EACH TIME: a material's lines carry its values now, and its parameters may have
       changed since the panel was drawn */
    let sections = []
    const row = ({ code, text, title, line = true, hay = '' }) => {
        const r = el('div', ROW)
        r.className = 'rt-code-insert-row'
        r.append(el('div', MONO, code))
        if (text) r.append(sentence(text))
        r.title = title || (line ? 'Click: put this line in the code' : 'Click: put this in the code at the caret')
        r.onmouseenter = () => { r.style.background = 'rgba(127,127,127,0.18)' }
        r.onmouseleave = () => { r.style.background = '' }
        r.onclick = () => insert(code, { line })
        r.dataset.hay = [code, text ?? '', title ?? '', hay].join(' ').toLowerCase()
        return r
    }
    const section = (title, rows, { open: o = false, id } = {}) => {
        if (!rows.length) return
        const d = el('details', { margin: '2px 0' })
        if (id) d.dataset.id = id
        d.open = o
        d.append(el('summary', { cursor: 'pointer', font: 'bold 11px sans-serif', padding: '2px 2px' }, `${title}  (${rows.length})`))
        for (const r of rows) d.append(r)
        sections.push({ d, rows, open: o })
        list.append(d)
    }
    function build() {
        list.textContent = ''
        sections = []
        const P = values() || {}
        // SET: a material's by group, the line from its values; the others' few
        const sets = setsOf(kind)
        const groups = [...new Set(sets.map(s => s.group ?? 'Set'))]
        for (const g of groups) {
            const rows = sets.filter(s => (s.group ?? 'Set') === g).map(s => row({
                code: s.code(P), text: s.brief,
                title: (s.panel ?? []).map(k => FIELD_HELP[k]).filter(Boolean).join('\n\n') || undefined,
                hay: [s.field, ...(s.fields ?? []), ...(s.panel ?? []), g].join(' '),
            }))
            section(groups.length > 1 || g !== 'Set' ? `Set · ${g}` : 'Set', rows, { open: g === groups[0], id: `set-${g.toLowerCase()}` })
        }
        // READ: what is in scope, and the block's own parameters by name
        const reads = B.reads.map(r => row({ code: r.name, text: `${r.type}: ${r.text}`, line: !!r.line }))
        const own = (params() || []).map(p => row({ code: p.name, text: `${p.type}: ${p.text ?? 'a parameter of this block'}`, line: false, hay: 'parameter' }))
        section('Read', [...reads, ...own], { open: !sets.length, id: 'read' })
        // RECIPES: whole lines that compile as they are
        section('Recipes', B.recipes.map(r => row({ code: recipeText(r), text: r.title })), { id: 'recipes' })
        // FUNCTIONS: CODE_HELP's sections this kind reaches for, a call with its arguments' names
        const S = sigs()
        for (const t of B.fns) {
            const sec = CODE_HELP.find(s => s.title === t)
            if (!sec) continue
            section(`Functions · ${t}`, Object.entries(sec.fns).filter(([n]) => S.has(n)).map(([n, words]) => row({
                code: callOf(S.get(n)), text: words, title: S.get(n), line: false,
            })), { id: `fn-${t}` })
        }
        if (kind === 'object') section('Functions · A scene\'s outlines and paths', Object.entries(CODE_MADE).map(([sig, words]) => row({
            code: callOf(typeWords(sig)), text: words, title: typeWords(sig), line: false })), { id: 'fn-made' })
        // CANNOT: said, not inserted
        const cannot = cannotOf(kind).map(c => {
            const r = el('div', { ...ROW, cursor: 'default' })
            r.append(el('div', MONO, c.name), sentence(c.why))
            r.dataset.hay = `${c.name} ${c.why}`.toLowerCase()
            return r
        })
        section('Cannot be set here', cannot, { id: 'cannot' })
        find(q.value)
    }
    let opened = null
    function find(words) {
        const w = String(words ?? '').toLowerCase().split(/\s+/).filter(Boolean)
        if (w.length && !opened) opened = sections.map(s => s.d.open)
        let n = 0
        sections.forEach((s, k) => {
            let m = 0
            for (const r of s.rows) { const hit = w.every(x => r.dataset.hay.includes(x)); r.hidden = !hit; if (hit) m++ }
            s.d.hidden = !m
            if (w.length) s.d.open = m > 0
            else if (opened) s.d.open = opened[k]
            n += m
        })
        if (!w.length) opened = null
        none.hidden = n > 0 || !sections.length
        return n
    }
    q.addEventListener('input', () => find(q.value))
    if (root.open) build()
    return {
        el: root,
        find: words => { if (!root.open) { root.open = true; build() } q.value = words; return find(words) },
        /** the rows shown, as their code, for a test */
        rows: () => sections.flatMap(s => s.rows.filter(r => !r.hidden).map(r => r.firstChild.textContent)),
    }
}

/** WHERE A LINE GOES (codeEditor's insert): a whole line on the caret's line when that is blank, else after it; a
 *  fragment at the caret. Never inside a comment's end or a word: a line is never split. `at` is the caret, or null for
 *  the end -- a box never clicked into is written at its end, under its comments. Returns { start, end, text, caret }:
 *  what to replace and where the caret is after. Pure, for a test. */
export function placeInsert(value, at, text, { line = true } = {}) {
    const v = String(value ?? '')
    const a = at == null ? v.length : Math.max(0, Math.min(v.length, at))
    if (!line) return { start: a, end: a, text, caret: a + text.length }
    const ls = v.lastIndexOf('\n', a - 1) + 1
    const nl = v.indexOf('\n', a), le = nl < 0 ? v.length : nl
    if (!v.slice(ls, le).trim()) return { start: ls, end: le, text, caret: ls + text.length }
    return { start: le, end: le, text: '\n' + text, caret: le + 1 + text.length }
}
