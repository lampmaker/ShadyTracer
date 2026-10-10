//======================================================================================================================
// RECIPE -- how a group combines its children, as text the user can read and write (model version 14: a join per
// child). Asked for as "a group of a, b, c, d: union of a, b, c, subtract d" (the user, 2026-09-30):
//
//     blend 0.1                  # the group's blend: the smoothness of every join without one of its own
//     union a, b, c              # a Plate, b Rib, c Rib
//     subtract d  blend 0.02     # d Hole
//
// The first name of the first line is the BASE, the shape the others meet; each line's op is the join of every
// other name on it, and `blend x` at its end is their own blend. Read top to bottom, as codegen combines them.
//
// A VIEW ONTO THE MODEL, NEVER A SECOND SOURCE OF TRUTH. Nothing here is stored: recipeOf() writes the text from
// the document, parseRecipe() reads text into a plan, and applyRecipe() replays the plan through the model's own
// operations (move, setJoin, setJoinBlend, setBlend), so everything a join is checked for is checked here too.
// The builder's last life had a property panel that wrote uniforms the document never saw.
//
// NAMES. Labels are not unique (three Ribs), so a name is a HANDLE: a letter by position among the group's shapes
// -- a, b ... z, aa, ab -- counting hidden ones, so hiding a child renames nothing; the tree shows the same
// letters. "A label" in quotes and @id are accepted too. A light and an export box are not shapes of the group
// (codegen shapesOf: never combined) and are not in the recipe; they keep their places among the children.
//
// PURE, like model.js: no DOM, no device. test/recipe.test.mjs.
//======================================================================================================================

import * as M from './model.js'
import { shapesOf, joinOf } from './codegen.js'

/** The tree's and the recipe's marks for a join; ● is the base, which joins nothing. */
export const GLYPH = { union: '∪', subtract: '−', intersect: '∩', base: '●' }

/* what a recipe line may start with: the words, and the marks the tree shows (a hyphen for the minus) */
const OP_WORDS = { union: 'union', subtract: 'subtract', intersect: 'intersect', '∪': 'union', '−': 'subtract', '-': 'subtract', '∩': 'intersect' }

/** The i-th handle: a ... z, aa, ab ... -- a spreadsheet's columns, in lower case. */
export function handleOf(i) {
    let s = ''
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(97 + (n - 1) % 26) + s
    return s
}

/** id -> handle, for a group's shapes (hidden ones included). */
export const handlesOf = g => new Map(shapesOf(g).map((c, i) => [c.id, handleOf(i)]))

/** The base: the first SHOWN shape -- what codegen takes once hidden nodes are pruned, and what live visibility's
 *  runtime flag picks. null when none shows. */
export const baseOf = g => shapesOf(g).find(c => c.enabled !== false) ?? null

/** The group in one line, for its tree row: `a ∪ b ∪ c − d` over the shown shapes, cut to `max` characters. */
export function summaryOf(g, max = 48) {
    const h = handlesOf(g), shown = shapesOf(g).filter(c => c.enabled !== false)
    const s = shown.map((c, i) => i === 0 ? h.get(c.id) : `${GLYPH[joinOf(c)]} ${h.get(c.id)}`).join(' ')
    return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/** The text of a group's recipe, from the document: consecutive shapes that join alike on one line. */
export function recipeOf(g) {
    const shapes = shapesOf(g), h = handlesOf(g)
    const out = []
    if (g.blend > 0) out.push(`blend ${g.blend}`)
    if (!shapes.length) return out.join('\n')
    const how = c => `${joinOf(c)} ${c.joinBlend ?? ''}`
    /* THE BASE OPENS A `union` LINE, which the shapes after it join while they join by union: "a less b" is
       `union a` / `subtract b`, not `subtract a, b` -- which reads as "subtract a and b" to anyone who has not
       read that the first name is the base. (The parser takes either: the first line's op is only ever its
       other names'.) */
    const lines = [{ op: 'union', blend: undefined, kids: [shapes[0]] }]
    for (const c of shapes.slice(1)) {
        const last = lines[lines.length - 1]
        if (last.kids.length === 1 && lines.length === 1) {
            if (joinOf(c) === 'union') { last.blend = c.joinBlend; last.kids.push(c) }
            else lines.push({ op: joinOf(c), blend: c.joinBlend, kids: [c] })
        } else if (how(c) === how(last.kids[last.kids.length - 1])) last.kids.push(c)
        else lines.push({ op: joinOf(c), blend: c.joinBlend, kids: [c] })
    }
    const pad = Math.max(...lines.map(l => l.op.length + 1 + l.kids.map(c => h.get(c.id)).join(', ').length
        + (l.blend != null ? `  blend ${l.blend}`.length : 0)))
    for (const l of lines) {
        const text = `${l.op} ${l.kids.map(c => h.get(c.id)).join(', ')}${l.blend != null ? `  blend ${l.blend}` : ''}`
        out.push(`${text.padEnd(pad)}  # ${l.kids.map(c => `${h.get(c.id)} ${c.label}`).join(', ')}`)
    }
    return out.join('\n')
}

/* one line into tokens, each with its column (1-based): words, "labels", @ids, commas; a # outside quotes ends it */
function tokens(line, lineNo, errors) {
    const out = []
    let i = 0
    while (i < line.length) {
        const ch = line[i]
        if (ch === ' ' || ch === '\t') { i++; continue }
        if (ch === '#') break
        const col = i + 1
        if (ch === ',') { out.push({ type: 'comma', col }); i++; continue }
        if (ch === '"') {
            const end = line.indexOf('"', i + 1)
            if (end < 0) { errors.push({ line: lineNo, col, message: 'a label in quotes is not closed' }); return out }
            out.push({ type: 'label', value: line.slice(i + 1, end), col }); i = end + 1; continue
        }
        let j = i
        while (j < line.length && !' \t,#"'.includes(line[j])) j++
        const word = line.slice(i, j)
        out.push(word.startsWith('@') ? { type: 'id', value: word.slice(1), col } : { type: 'word', value: word, col })
        i = j
    }
    return out
}

const isBlendValue = t => t?.type === 'word' && /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?$/i.test(t.value)

/**
 * Text into a plan for group `g` (a document's group). Returns { plan, errors }: plan is null while there are
 * errors, each { line, col, message } at the place it is about.
 * plan: { blend, order: [shape ids], joins: { id: op }, blends: { id: number | null } } -- every shape once.
 */
export function parseRecipe(text, g) {
    const errors = []
    const shapes = shapesOf(g), h = handlesOf(g)
    const byHandle = new Map(shapes.map(c => [h.get(c.id), c]))
    const names = `${shapes.map(c => h.get(c.id)).slice(0, 4).join(', ')}${shapes.length > 4 ? ', ...' : ''}`
    let blend = null
    const entries = []
    const seen = new Map()
    const lines = String(text ?? '').split('\n')
    lines.forEach((raw, k) => {
        const lineNo = k + 1
        const t = tokens(raw, lineNo, errors)
        if (!t.length) return
        const head = t[0]
        if (head.type === 'word' && head.value === 'blend') {
            if (blend != null) return errors.push({ line: lineNo, col: head.col, message: 'the group\'s blend is given twice' })
            if (!isBlendValue(t[1]) || t.length > 2)
                return errors.push({ line: lineNo, col: (t[1] ?? head).col, message: 'blend takes one number, 0 or more: blend 0.1' })
            blend = Number(t[1].value)
            return
        }
        const op = head.type === 'word' ? OP_WORDS[head.value] : null
        if (!op) return errors.push({ line: lineNo, col: head.col,
            message: `a line starts with union, subtract or intersect (or ∪ − ∩), not '${head.value ?? head.type}'` })
        // `blend x` at the end: this line's own blend
        let rest = t.slice(1), own = null
        if (rest.length >= 2 && rest[rest.length - 2].type === 'word' && rest[rest.length - 2].value === 'blend') {
            const v = rest[rest.length - 1]
            if (!isBlendValue(v)) return errors.push({ line: lineNo, col: v.col, message: 'blend takes one number, 0 or more' })
            own = Number(v.value)
            rest = rest.slice(0, -2)
        }
        if (!rest.length) return errors.push({ line: lineNo, col: head.col, message: `nothing after '${head.value}': name the children it joins` })
        // names, separated by commas
        rest.forEach((tok, i) => {
            const wantName = i % 2 === 0
            if (!wantName) {
                if (tok.type !== 'comma') errors.push({ line: lineNo, col: tok.col, message: 'names are separated by commas: union a, b, c' })
                return
            }
            let c = null
            if (tok.type === 'word') {
                if (tok.value === 'blend') return errors.push({ line: lineNo, col: tok.col, message: 'blend goes at the end of a line, with its number' })
                c = byHandle.get(tok.value)
                if (!c) return errors.push({ line: lineNo, col: tok.col,
                    message: `no child '${tok.value}' in this group (its children are ${names || 'none'}; a label goes in quotes)` })
            } else if (tok.type === 'label') {
                const hits = shapes.filter(s => s.label === tok.value)
                if (!hits.length) return errors.push({ line: lineNo, col: tok.col, message: `no child labelled "${tok.value}" in this group` })
                if (hits.length > 1) return errors.push({ line: lineNo, col: tok.col,
                    message: `"${tok.value}" is ${hits.length} children here (${hits.map(s => h.get(s.id)).join(', ')}): name one by its letter` })
                c = hits[0]
            } else if (tok.type === 'id') {
                c = shapes.find(s => s.id === tok.value)
                if (!c) return errors.push({ line: lineNo, col: tok.col, message: `no child @${tok.value} in this group` })
            } else return errors.push({ line: lineNo, col: tok.col, message: 'a name is missing between two commas' })
            if (seen.has(c.id)) {
                const at = seen.get(c.id)
                return errors.push({ line: lineNo, col: tok.col, message: `${h.get(c.id)} (${c.label}) is listed twice: first at line ${at.line}` })
            }
            seen.set(c.id, { line: lineNo })
            entries.push({ id: c.id, op, own })
        })
        if (rest.length % 2 === 0) errors.push({ line: lineNo, col: rest[rest.length - 1].col, message: 'a comma with no name after it' })
    })
    const missing = shapes.filter(c => !seen.has(c.id))
    if (shapes.length && !entries.length && !errors.length)
        errors.push({ line: 1, col: 1, message: `nothing to combine: list the children, e.g. union ${names}` })
    else for (const c of missing) errors.push({ line: lines.length, col: 1,
        message: `${h.get(c.id)} (${c.label}) is not in the recipe: every child of the group is listed once` })
    if (errors.length) return { plan: null, errors }
    // the first is the base: it joins nothing, and its own blend is nobody's (applyRecipe: one that stays keeps its own)
    const plan = { blend: blend ?? 0, order: entries.map(e => e.id), joins: {}, blends: {} }
    entries.forEach((e, i) => { plan.joins[e.id] = i === 0 ? 'union' : e.op; plan.blends[e.id] = i === 0 ? null : e.own })
    return { plan, errors: [] }
}

/**
 * The plan into the document, through the model's operations: the shapes into the plan's order (a light or an
 * export box keeps its place among the children), each one's join and own blend, the group's blend. Tried on a
 * copy first, so a plan the model refuses changes nothing; then for real. Returns the group.
 */
export function applyRecipe(doc, gid, plan) {
    const run = d => {
        const g = M.find(d, gid)?.node
        if (!g || g.kind !== 'group') throw new M.ModelError(`no group '${gid}'`)
        const shapes = shapesOf(g)
        if (plan.order.length !== shapes.length || !shapes.every(c => plan.order.includes(c.id)))
            throw new M.ModelError('the recipe does not list this group\'s children as they are now: write it again from the panel')
        // the final children: shapes in the plan's order into the shapes' slots, everything else where it was
        const next = plan.order.map(id => shapes.find(s => s.id === id))
        let k = 0
        const final = g.children.map(c => shapes.includes(c) ? next[k++] : c)
        final.forEach((c, i) => { if (g.children[i] !== c) M.move(d, c.id, gid, i) })
        /* A BASE THAT STAYS THE BASE KEEPS ITS OWN JOIN AND BLEND. The model keeps them on the first shape, dormant
           (model.js OPS): a node dragged to the top has them again when it is dragged down. No recipe can show them
           -- the base's line's op and blend are its other names' (recipeOf) -- so writing union and none over them
           changed a group whose own recipe, shown as "as the group is", was applied unchanged: OpticsBench's lens
           holders, whose first box joins by intersect (recipe.test, until 2026-10-07). A shape the recipe MAKES the
           base still joins nothing, as written (test/panel.check.mjs). */
        const stays = shapes[0]?.id === plan.order[0]
        for (const id of stays ? plan.order.slice(1) : plan.order) {
            M.setJoin(d, id, plan.joins[id])
            M.setJoinBlend(d, id, plan.blends[id])
        }
        M.setBlend(d, gid, plan.blend)
        const bad = M.validate(d)
        if (bad.length) throw new M.ModelError(bad)
        return g
    }
    run(structuredClone(doc))
    return run(doc)
}
