// node lib/pathtracer/test/recipe.test.mjs
//
// THE DARKROOM'S RECIPE (lib/pathtracer/darkroom/recipe.js, 0.next), no DOM: the settings there and back as a recipe;
// what comes in read key by key -- unknown keys left out, a value of the wrong kind refused, the curves normalised, a
// file name never a setting, another kind of JSON refused; the clipboard's text; named presets in a stand-in storage,
// and one that is full, blocked or holds garbage reading as none; the settings read back out of a PNG the Darkroom's
// export wrote (its Comment text), and a light file's or a stranger's refused.
import { toRecipe, fromRecipe, recipeFromText, recipeFromPicture, pngText, presets, makeUndo, RECIPE_KIND, PRESETS_KEY } from '../darkroom/recipe.js'
import { viewSettings } from '../develop.js'
import { describe } from '../darkroom/export/index.js'
import { makePNG16, insertText } from '../darkroom/export/png.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

const defaults = { ...viewSettings({ exposureEV: 12, toneMap: 1 }), filename: 'render', status: '' }
const mine = { ...defaults, ev: 10.4, wbTemp: 3200, eq2: 0.75, dither: true, curves: { ...defaults.curves, r: [[0, 0], [0.5, 0.62], [1, 1]] },
               filename: 'my shot', status: 'saved' }
{
    const r = toRecipe(mine, defaults)
    ok('a recipe: its kind and version, every setting, not the file name or status', r.kind === RECIPE_KIND && r.version === 1 && r.settings.ev === 10.4
        && r.settings.wbTemp === 3200 && r.settings.dither === true && !('filename' in r.settings) && !('status' in r.settings))
    const back = fromRecipe(JSON.parse(JSON.stringify(r)), defaults)
    ok('...and back: the same settings', !back.error && Object.entries(r.settings).every(([k, v]) => JSON.stringify(back.settings[k]) === JSON.stringify(v))
        && back.ignored.length === 0)
}
{
    const x = fromRecipe({ kind: RECIPE_KIND, settings: { ev: '9.5', wbTemp: 'warm', dither: 'yes', bogus: 1, filename: 'x', eq0: null, curves: { m: [[0.5, 2], [0, 0]] } } }, defaults)
    ok('read key by key: a number as text taken, a word for a number refused, a non-boolean switch refused, an unknown key left out',
        x.settings.ev === 9.5 && !('wbTemp' in x.settings) && !('dither' in x.settings) && !('bogus' in x.settings) && !('filename' in x.settings)
        && !('eq0' in x.settings) && x.ignored.includes('bogus') && x.ignored.includes('wbTemp'), JSON.stringify(x))
    ok('...the curves normalised (clamped, sorted, the other channels straight)', JSON.stringify(x.settings.curves.m) === '[[0,0],[0.5,1]]'
        && JSON.stringify(x.settings.curves.g) === '[[0,0],[1,1]]')
    ok('another kind of JSON refused', fromRecipe({ kind: 'scene' }, defaults).error && fromRecipe(null, defaults).error)
    ok('a bare settings object read too', fromRecipe({ ev: 8 }, defaults).settings.ev === 8)
    ok('the clipboard\'s text: JSON read, anything else said', recipeFromText(JSON.stringify(toRecipe(mine, defaults)), defaults).settings.eq2 === 0.75
        && /not JSON/.test(recipeFromText('hello', defaults).error))
}
{
    const mem = new Map(), storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }
    const P = presets(storage)
    ok('no presets yet', P.names().length === 0)
    ok('saved by name, listed in order, read back', P.save('Warm room', toRecipe(mine, defaults)) && P.save('a cool one', toRecipe(defaults, defaults))
        && P.names().join() === 'a cool one,Warm room' && P.get('Warm room').settings.wbTemp === 3200)
    ok('...a name blank refused, a long one cut', !P.save('  ', {}) && P.save('x'.repeat(100), {}) && P.names().some(n => n.length === 60))
    ok('...one removed', P.remove('a cool one') && !P.names().includes('a cool one') && !P.remove('nope'))
    ok('...kept under one key', mem.has(PRESETS_KEY))
    mem.set(PRESETS_KEY, '{broken')
    ok('a store holding garbage reads as none', presets(storage).names().length === 0)
    const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') } }
    ok('a store that throws: none, and a save says it did not', presets(blocked).names().length === 0 && presets(blocked).save('a', {}) === false)
    ok('no store at all: none', presets(undefined).names().length === 0)
}
{
    // a PNG as the Darkroom's export writes it: its Comment is describe()'s JSON
    const pic = { w: 2, h: 1, samples: 32, view: { show: 0 } }
    const about = describe({ ex: { format: 'png16' }, pic, settings: mine, ev: mine.ev, build: 'ShadyTracer test' })
    const P = makePNG16(2, 1); await P.addRows(new Uint16Array(6), 1)
    const bytes = new Uint8Array(await (await P.finish([['Software', about.software], ['Comment', about.json]])).arrayBuffer())
    ok('a PNG\'s text read: iTXt', pngText(bytes).Software === 'ShadyTracer test')
    const r = recipeFromPicture(bytes, defaults)
    ok('the settings read back out of a saved PNG', !r.error && r.settings.ev === 10.4 && r.settings.wbTemp === 3200 && r.settings.dither === true
        && JSON.stringify(r.settings.curves.r) === JSON.stringify([[0, 0], [0.5, 0.62], [1, 1]]) && !('filename' in r.settings), JSON.stringify(r).slice(0, 200))
    ok('...into an 8-bit PNG too (text put in after IHDR)', recipeFromPicture(insertText(bytes.slice(), [['Comment', about.json]]), defaults).settings.ev === 10.4)
    const light = describe({ ex: { format: 'exr' }, pic, settings: mine, ev: 10, build: 'b' })
    const L = makePNG16(2, 1); await L.addRows(new Uint16Array(6), 1)
    const lb = new Uint8Array(await (await L.finish([['Comment', light.json]])).arrayBuffer())
    ok('a light file\'s description refused: it has no develop settings', /no develop settings/.test(recipeFromPicture(lb, defaults).error))
    ok('not a PNG, a PNG with no settings: said', recipeFromPicture(new Uint8Array([1, 2, 3]), defaults).error === 'not a PNG'
        && /does not say/.test(recipeFromPicture(new Uint8Array(await (await (async () => { const Q = makePNG16(1, 1); await Q.addRows(new Uint16Array(3), 1); return Q.finish() })()).arrayBuffer()), defaults).error))
}

{
    let t = 0
    const U = makeUndo('a', { now: () => t, window: 800 })
    ok('nothing to undo at first', !U.canUndo && U.undo() === null)
    ok('the same text: no step', U.commit('a') === false && !U.canUndo)
    U.commit('b', 'ev'); t += 100; U.commit('c', 'ev'); t += 100; U.commit('d', 'ev')
    ok('a drag (one key, close together) is one step', U.undo() === 'a' && !U.canUndo)
    ok('...and redone whole', U.redo() === 'd' && !U.canRedo)
    t += 1000; U.commit('e', 'ev')
    ok('a pause starts the next step', U.undo() === 'd' && U.undo() === 'a')
    U.redo(); U.commit('x', 'wb')
    ok('a new edit ends the redo branch', !U.canRedo && U.undo() === 'd')
    const L = makeUndo('0', { limit: 3 })
    for (const s of ['1', '2', '3', '4', '5']) L.commit(s)
    let n = 0; while (L.undo() !== null) n++
    ok('at most `limit` steps kept', n === 3)
    U.reset('z')
    ok('reset: nothing either way', !U.canUndo && !U.canRedo)
}

console.log(`recipe: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
