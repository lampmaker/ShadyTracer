//======================================================================================================================
// Tests for undo / redo. Run: node builder/test/history.test.mjs
//
// The properties an undo has to have, each of which is easy to get subtly wrong: a step per edit,
// one step per drag, nothing recorded for a non-change, redo that dies on a new edit, a limit.
//======================================================================================================================
import { createHistory } from '../history.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) =>
    ok(name, JSON.stringify(got) === JSON.stringify(want),
        `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)

let t = 0
const clock = () => t

{
    const h = createHistory('A', { now: clock })
    eq('nothing to undo at first', h.undo(), null)
    ok('a change is a step', h.commit('B'))
    ok('the same text again is not', !h.commit('B'))
    h.commit('C')
    eq('undo goes back one step', h.undo(), 'B')
    eq('and another', h.undo(), 'A')
    eq('and stops at the start', h.undo(), null)
    eq('redo comes forward', h.redo(), 'B')
    eq('to the end', h.redo(), 'C')
    eq('and stops there', h.redo(), null)
}

{
    // a slider drag: same key, quick succession -> one step
    t = 0
    const h = createHistory('r=1', { now: clock, window: 800 })
    for (const v of [1.1, 1.2, 1.3, 1.4]) { t += 16; h.commit(`r=${v}`, 'ball.radius') }
    eq('a drag is one undo step', h.depth.undo, 1)
    eq('which goes back to before the drag', h.undo(), 'r=1')
    eq('and redo to its end', h.redo(), 'r=1.4')

    // a pause starts a new step, even on the same control
    t += 2000; h.commit('r=2', 'ball.radius')
    eq('a pause starts a new step', h.depth.undo, 2)
    // a different control starts one at once
    t += 10; h.commit('r=2;m=x', 'ball.material')
    eq('another control starts a new step', h.depth.undo, 3)
    // no key never merges
    t += 1; h.commit('r=2;m=y'); t += 1; h.commit('r=2;m=z')
    eq('a keyless commit never merges', h.depth.undo, 5)
}

{
    // after an undo, the next same-key edit is a new step, not a rewrite of the one undone into
    t = 0
    const h = createHistory('0', { now: clock })
    t += 10; h.commit('1', 'k')
    h.undo()
    t += 10; h.commit('2', 'k')
    eq('an edit after undo is its own step', [h.depth.undo, h.undo()], [1, '0'])
}

{
    const h = createHistory('A', { now: clock })
    h.commit('B'); h.commit('C'); h.undo()
    ok('redo is available after undo', h.canRedo)
    h.commit('D')
    ok('a new edit ends the redo branch', !h.canRedo)
    eq('and undo goes back through it', [h.undo(), h.undo()], ['B', 'A'])
}

{
    const h = createHistory('0', { now: clock, limit: 3 })
    for (const s of ['1', '2', '3', '4', '5']) h.commit(s)
    eq('the limit keeps the newest steps', h.depth.undo, 3)
    eq('and drops the oldest', [h.undo(), h.undo(), h.undo(), h.undo()], ['4', '3', '2', null])
}

{
    const h = createHistory('A', { now: clock })
    h.commit('B'); h.reset('Z')
    ok('reset forgets both ways', !h.canUndo && !h.canRedo)
    h.commit('Y')
    eq('and starts from the new text', h.undo(), 'Z')
}

{
    // WHAT A STEP WAS (0.63.0): the meta given with a commit comes back as `step` when that step is undone or redone
    const h = createHistory('A', { now: clock })
    h.commit('B', null, { scenes: 'delete' }); h.commit('C'); h.commit('D', null, { scenes: 'copy to' })
    eq('an undo gives the meta of the step it undid', [h.undo(), h.step], ['C', { scenes: 'copy to' }])
    eq('...a step committed with none, null', [h.undo(), h.step], ['B', null])
    eq('...and the one before it', [h.undo(), h.step], ['A', { scenes: 'delete' }])
    eq('a redo gives the meta of the step it redid', [h.redo(), h.step], ['B', { scenes: 'delete' }])
    eq('...each in turn', [h.redo(), h.step, h.redo(), h.step], ['C', null, 'D', { scenes: 'copy to' }])
    h.undo(); h.commit('E', null, { scenes: 'rename' })
    eq('a new edit after an undo keeps its own', [h.undo(), h.step], ['C', { scenes: 'rename' }])
}
{
    let t = 0
    const h = createHistory('0', { now: () => t })
    h.commit('1', 'drag', { first: true }); t += 10; h.commit('2', 'drag', { second: true })
    eq('a merged step keeps the meta of its first commit', [h.undo(), h.step], ['0', { first: true }])
}
{
    const h = createHistory('0', { now: clock, limit: 2 })
    h.commit('1', null, 'one'); h.commit('2', null, 'two'); h.commit('3', null, 'three')
    eq('the limit drops a step\'s meta with it', [h.undo(), h.step, h.undo(), h.step, h.undo()], ['2', 'three', '1', 'two', null])
    h.reset('Z'); h.commit('Y')
    eq('reset forgets the metas too', [h.undo(), h.step], ['Z', null])
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
