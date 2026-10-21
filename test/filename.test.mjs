//======================================================================================================================
// Tests for a saved file's name with the time it was saved (lib/filename.js). Run: node test/filename.test.mjs
//
// What has to hold, none of it needing a GPU or a browser:
//   the stamp is local time, largest unit first, zero-padded, and holds no character a file system refuses (`:` on
//     Windows) or a shell trips over (a space) -- so names sort as they were made.
//   a name is the base, the stamp and the extension; one asked for twice in the same second is told apart (-2, -3),
//     another base in that second is not, and the next second starts over.
//======================================================================================================================
import { timestamp, stampedName } from '../lib/filename.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) =>
    ok(name, JSON.stringify(got) === JSON.stringify(want),
        `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)

// ---- the stamp ------------------------------------------------------------------------------------------------------
// new Date(y, m, d, ...) is local time, as timestamp() reads it: the test holds in any time zone
const at = (...a) => new Date(2026, ...a)
eq('local time, largest unit first, zero-padded', timestamp(at(0, 2, 3, 4, 5)), '2026-01-02_03-04-05')
eq('two-digit fields as they are', timestamp(at(11, 31, 23, 59, 58)), '2026-12-31_23-59-58')
ok('nothing a file system or a shell refuses', /^[0-9_-]+$/.test(timestamp()), timestamp())
const a = at(9, 19, 9, 0, 0), b = at(9, 19, 10, 0, 0)
ok('...and it sorts as the times do', timestamp(a) < timestamp(b) && timestamp(at(8, 30, 23, 59, 59)) < timestamp(a))

// ---- the name -------------------------------------------------------------------------------------------------------
const t = at(9, 19, 14, 3, 22)
eq('base, stamp, extension', stampedName('render', 'png', t), 'render-2026-10-19_14-03-22.png')
eq('the same name in the same second: told apart', stampedName('render', 'png', t), 'render-2026-10-19_14-03-22-2.png')
eq('...and again', stampedName('render', 'png', t), 'render-2026-10-19_14-03-22-3.png')
eq('another base in that second is its own', stampedName('map', 'png', t), 'map-2026-10-19_14-03-22.png')
eq('the same base, another extension: the stamp before the extension is the same name, so told apart',
   stampedName('render', 'mp4', t), 'render-2026-10-19_14-03-22-4.mp4')
eq('no extension: the caller adds one', stampedName('raytracer', '', at(9, 19, 14, 3, 23)), 'raytracer-2026-10-19_14-03-23')
eq('the next second starts over', stampedName('render', 'png', at(9, 19, 14, 3, 23)), 'render-2026-10-19_14-03-23.png')
eq('an empty base is still a name', stampedName('', 'png', at(9, 19, 14, 3, 24)), 'file-2026-10-19_14-03-24.png')
ok('the current time by default', /^x-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d(-\d+)?\.png$/.test(stampedName('x', 'png')))

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
