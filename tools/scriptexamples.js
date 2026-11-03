//======================================================================================================================
// THE SCRIPT PANEL'S EXAMPLES (tools/script.js, 0.next): a start for each thing the user asked a script for (2026-11-03)
// -- reading and writing the settings, a generative series rendered to files, a lens tuned by its analysis. Each works on
// whatever scene it is run in: it finds what it moves (the settings flagged animated, a light, a detector) rather than
// naming an id only one scene has, and says what is missing when the scene lacks it. tools/test/script.test.mjs compiles
// every one and runs the first two against a stand-in page.
//======================================================================================================================

export const SCRIPT_EXAMPLES = [
    {
        id: 'settings', label: 'Read and write settings',
        code: `// Every setting has a path: scene/<node id>/<name>, renderer/..., view/camera/...
// The ones flagged animated (★ in Properties) are listed first; any path can be read and set.
const mine = params.animated()
log(mine.length ? \`\${mine.length} animated:\` : 'nothing flagged animated: listing the scene\\'s first ten settings')
for (const p of (mine.length ? mine : params.list('scene').slice(0, 10)))
    log(p.path, '=', p.value, p.unit ?? '', p.kind === 'structural' ? '(compiles)' : '')

log('camera:', camera.get())
log('nodes:', scene.nodes().map(n => \`\${n.label} (\${n.id})\`).join(', '))

// A setting as a variable: drag its name from the Parameters panel onto an empty line, or write
//     const radius = param('scene/n4/radius')
//     radius.value = 2.5              radius.value *= 1.1           log(radius * 2)
//     const pos = param('scene/n4/transform/position')
//     pos.value = [1, 2, 4]           let x = pos[0]                pos.z = 4
// Writes make no undo step (radius.set(2.5, { undo: true }) makes one).
// camera.set({ azimuth: 30, elevation: 70 })
`,
    },
    {
        id: 'generative', label: 'Generative series: random settings, a render each',
        code: `// A series of pictures, each with the animated settings (★ in Properties) set at random within
// their ranges, rendered and saved. The same seed gives the same series.
const N = 4, SIZE = { width: 800, height: 800, samples: 64 }
let seed = 12345
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)

const moving = params.animated().filter(p => p.kind !== 'structural' && p.min != null && p.max != null)
if (!moving.length) throw new Error('flag a few settings animated first (★ beside a value in Properties), each with a range')
const start = Object.fromEntries(moving.map(p => [p.path, p.value]))

for (let i = 0; i < N; i++) {
    for (const p of moving) {
        const one = () => p.min + random() * (p.max - p.min)
        params.set(p.path, p.dims > 1 ? Array.from({ length: p.dims }, one) : one())
    }
    const pic = await render(SIZE)
    await pic.save(\`series-\${String(i + 1).padStart(3, '0')}.png\`)
    log(\`picture \${i + 1} of \${N}\`)
}
params.apply(start)              // the settings as they were
`,
    },
    {
        id: 'beam', label: 'Analysis: the numbers off the far field and a detector',
        code: `// One analysis, as ▶ Run in the Analysis pane runs it (the charts show it too), and its numbers.
const a = await optics.run({ rays: 1e6 })
log('emitted', a.totals.emitted, 'escaped', a.totals.escaped)
if (a.note) warn(a.note)

if (a.hasFarField) {
    const s = a.stats({ planes: [0, 90] })
    log('I max', s.max.I.toFixed(1), 'cd at gamma', s.max.gamma, 'C', s.max.C)
    log('beam angle C0', s.planes[0].beam?.width, '  field angle', s.planes[0].field?.width)
    log('flux within 10 deg', a.fluxWithin(10).toFixed(2), 'lm of', a.farFlux.toFixed(2))
    files.save('intensity.csv', a.intensityCSV())
}
for (const d of a.detectors()) {
    const m = a.map(d.tag, { cells: 64 })
    log(d.name, ': E max', m.max.toFixed(1), m.unit, ' mean', m.meanLit.toFixed(1), ' U0', m.uniformity?.toFixed(2), ' r50', m.encircled().r50)
}
`,
    },
    {
        id: 'lens', label: 'Optimise a lens: one setting against the peak intensity',
        code: `// A one-setting search (golden section) for the largest I max. Put the path of the setting to tune
// below -- the Parameters panel shows every path; Ctrl K finds one by name -- and its range.
const PATH = params.animated()[0]?.path       // or 'scene/n7/radius', ...
const LO = null, HI = null                    // null: the setting's own range
const RAYS = 300000, STEPS = 10

if (!PATH) throw new Error('flag the setting to tune animated (★ in Properties), or write its path above')
const p = params.info(PATH)
let a = LO ?? p.min, b = HI ?? p.max
if (a == null || b == null) throw new Error(\`'\${PATH}' has no range: give LO and HI\`)

const merit = async x => {
    params.set(PATH, x)
    if (p.kind === 'structural') await settled()     // a compile
    const r = await optics.run({ rays: RAYS })
    const v = r.peak().I                         // or r.fluxWithin(10), r.map('screen').max, ...
    log(PATH, '=', x, '->', v)
    return v
}
const g = (Math.sqrt(5) - 1) / 2
let c = b - g * (b - a), d = a + g * (b - a), fc = await merit(c), fd = await merit(d)
const rows = [[c, fc], [d, fd]]
for (let i = 0; i < STEPS; i++) {
    if (fc > fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = await merit(c); rows.push([c, fc]) }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = await merit(d); rows.push([d, fd]) }
    progress(i + 1, STEPS, 'golden section')
}
const best = fc > fd ? c : d
params.set(PATH, best, { undo: true })           // one undo step: Ctrl Z puts it back
log('best', PATH, '=', best)
files.save('search.csv', [['value', 'I max (cd)'], ...rows])
`,
    },
    {
        id: 'turntable', label: 'Turntable: the camera around, a frame each',
        code: `// The camera orbits its target; each frame is rendered and saved. The camera is put back after.
const FRAMES = 12, SIZE = { width: 960, height: 540, samples: 32 }
const was = camera.get()
try {
    for (let i = 0; i < FRAMES; i++) {
        camera.set({ mode: 'orbit', azimuth: (was.azimuth ?? 0) + 360 * i / FRAMES })
        const pic = await render(SIZE)
        await pic.save(\`turn-\${String(i).padStart(3, '0')}.png\`)
        progress(i + 1, FRAMES, 'turntable')
    }
} finally { camera.set(was) }
`,
    },
]
