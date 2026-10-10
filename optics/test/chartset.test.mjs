// node optics/test/chartset.test.mjs
//
// THE CHARTS THAT EXIST (optics/charts.js), without a DOM: the six kinds' first always, at the ids a saved
// layout knows; another of a kind numbered after the highest, its settings copied and not shared; the first
// never removed; the list and every chart's settings kept and read back (the host registers a panel per entry
// before the layout naming them is restored -- one lost here is a chart lost from the layout); and whatever
// was stored that does not fit -- another version's settings, a wrong type, an unknown kind, not JSON -- read
// as the defaults rather than handed to a property table.
import { chartSet, chartName, OPTICS_CHARTS, CHART_DEFAULTS, FAR_CHARTS, MAP_CHARTS } from '../charts.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const throws = f => { try { f(); return false } catch { return true } }
const memory = (init = {}) => { const m = { ...init }; return { m, getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = String(v) } } }

{
    const kinds = OPTICS_CHARTS.map(c => c.key)
    ok('every kind has its defaults', kinds.every(k => CHART_DEFAULTS[k]) && Object.keys(CHART_DEFAULTS).length === kinds.length)
    ok('every kind is the far field\'s or the map\'s, once', [...FAR_CHARTS, ...MAP_CHARTS].sort().join() === [...kinds].sort().join())
    ok('the first of a kind is at the kind\'s own id; another numbered', chartName('map', 1).id === 'optics.map' && chartName('map', 3).id === 'optics.map.3'
       && chartName('map', 3).title === 'Map 3' && chartName('igamma', 1).title === 'I – γ')
}

{
    const S = chartSet()
    const list = S.list()
    ok('kept nowhere: the six kinds\' first, in order, at the ids saved layouts know',
       list.map(c => c.id).join() === OPTICS_CHARTS.map(c => c.id).join() && list.every(c => c.n === 1), list.map(c => c.id).join())
    ok('...each with its kind\'s defaults, its own copy', list.every(c => JSON.stringify(c.s) === JSON.stringify(CHART_DEFAULTS[c.type]) && c.s !== CHART_DEFAULTS[c.type]))
    const map = S.get('optics.map')
    map.s.q = 'CCT'
    const m2 = S.add('map', map.s)
    ok('another map: optics.map.2, "Map 2", its settings copied', m2.id === 'optics.map.2' && m2.title === 'Map 2' && m2.s.q === 'CCT' && S.get('optics.map.2') === m2)
    m2.s.q = 'x'
    ok('...and not shared: changing one leaves the other', map.s.q === 'CCT')
    ok('another without settings: the defaults', S.add('map').s.q === 'E' && S.get('optics.map.3'))
    ok('a kind that is not one is refused', throws(() => S.add('spectrum')))
    ok('the first of a kind is never removed', S.remove('optics.map') === false && S.get('optics.map'))
    ok('an added one is', S.remove('optics.map.2') === true && !S.get('optics.map.2') && S.remove('optics.map.2') === false)
    ok('numbered after the highest there is, not into a gap', S.add('map').id === 'optics.map.4')
    S.remove('optics.map.3'); S.remove('optics.map.4')
    ok('...and when none is left after the first, 2 again', S.add('map').id === 'optics.map.2')
    ok('a chart that is not there is null', S.get('optics.nothing') === null)
}

{
    // KEPT, AND READ BACK: the list and each chart's settings, the first's too
    const store = memory()
    const A = chartSet({ key: 'charts', storage: store })
    A.add('map', { ...A.get('optics.map').s, q: 'CCT' })
    A.get('optics.polar').s.planes = '0, 45, 90'
    A.save()
    A.add('profiles')
    const B = chartSet({ key: 'charts', storage: store })
    ok('read back: the six and the two added, in order', B.list().map(c => c.id).join() === [...OPTICS_CHARTS.map(c => c.id), 'optics.map.2', 'optics.profiles.2'].join(),
       B.list().map(c => c.id).join())
    ok('...each with its settings', B.get('optics.map.2').s.q === 'CCT' && B.get('optics.polar').s.planes === '0, 45, 90' && B.get('optics.map').s.q === 'E')
    A.remove('optics.map.2')
    ok('a removal is kept', !chartSet({ key: 'charts', storage: store }).get('optics.map.2'))
    ok('another key keeps another list', chartSet({ key: 'other', storage: store }).list().length === OPTICS_CHARTS.length)
}

{
    // WHAT DOES NOT FIT, read as the defaults
    const junk = [
        { type: 'map', n: 1, s: { q: 7, isolines: 'off', exposure: '2', gone: true } },
        { type: 'map', n: 2, s: null },
        { type: 'map', n: 2, s: { q: 'x' } },              // the same chart twice: the first kept
        { type: 'spectrum', n: 2, s: {} },                 // a kind that is not one
        { type: 'polar', n: 1.5, s: {} },                  // not a number of one
        { type: 'rings', n: 0 },
        null, 'map',
    ]
    const S = chartSet({ key: 'k', storage: memory({ k: JSON.stringify(junk) }) })
    const map = S.get('optics.map')
    ok('a stored setting of the wrong type is the default; one of the right type is kept', map.s.q === 'E' && map.s.isolines === 'off' && map.s.exposure === 1)
    ok('...and one this version does not have is left out', !('gone' in map.s))
    ok('only the charts that can be: map 2 once, with the defaults', S.list().map(c => c.id).join() === [...OPTICS_CHARTS.map(c => c.id), 'optics.map.2'].join()
       && S.get('optics.map.2').s.q === 'E', S.list().map(c => c.id).join())
    for (const [what, v] of [['not JSON', '{'], ['not a list', '{"type":"map"}'], ['null', 'null']])
        ok(`stored ${what}: the six`, chartSet({ key: 'k', storage: memory({ k: v }) }).list().length === OPTICS_CHARTS.length)
    const full = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    ok('a storage that refuses to keep: no throw, the chart made', !throws(() => chartSet({ key: 'k', storage: full }).add('map')))
    ok('no storage at all (a key, nothing to keep it in): the six', chartSet({ key: 'k', storage: null }).list().length === OPTICS_CHARTS.length)
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
