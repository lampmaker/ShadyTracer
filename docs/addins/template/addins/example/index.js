//======================================================================================================================
// AN EXAMPLE ADD-IN: a setting swept against a detector's uniformity -- the loop an inverse design is made of, in
// miniature. Set a value, wait for the scene, trace the optics, read the detector, keep the best.
//
// Copy this folder into your private repository (docs/addins/template/README.md) and make it yours. It reaches the
// page only through `st` (docs/ADDINS.md): no import of the page's files by a relative path, which would tie it to
// where the two are served from. lib/addins/test/loader.test.mjs runs this file, through the real loader and API,
// over stand-ins (its copy at lib/addins/test/fixtures/example.js is held to this one byte for byte).
//======================================================================================================================

export const addin = { id: 'example', name: 'Example: sweep', api: 1, version: '1' }

/**
 * Sweep one setting from `from` to `to` in `steps` values and trace the optics at each; resolves with every step's
 * { value, uniformity, mean } and the best (highest uniformity), the setting left at the best.
 * `script` is st.script (tools/scriptapi.js); `part` picks one number of a vector setting (0, 1, 2), or null.
 */
export async function sweep(script, { path, from, to, steps = 5, detector = null, part = null, cells = 32, onStep = () => { } }) {
    const { params, settled, optics } = script
    const info = params.info(path)                              // throws, naming what is near, for a path that is not there
    if (info.dims > 1 && part == null) throw new Error(`${path} has ${info.dims} numbers: say which (part 0 to ${info.dims - 1})`)
    const valueAt = v => {
        if (part == null) return v
        const a = params.get(path).slice()
        a[part] = v
        return a
    }
    const n = Math.max(2, steps | 0)
    const rows = []
    for (let i = 0; i < n; i++) {
        const v = from + (to - from) * i / (n - 1)
        params.set(path, valueAt(v))
        await settled()                                         // a structural setting compiles first
        const r = await optics.run()
        const d = detector ?? r.detectors()[0]?.name
        if (d == null) throw new Error('the scene has no detector to read')
        const m = r.map(d, { cells })
        const row = { value: v, uniformity: m.uniformity, mean: m.meanLit }
        rows.push(row)
        onStep(row, i, n)
    }
    const best = rows.reduce((b, r) => (r.uniformity ?? -1) > (b.uniformity ?? -1) ? r : b, rows[0])
    params.set(path, valueAt(best.value))
    return { rows, best }
}

let panelEl = null

/** Early: the panel and the command, so a saved layout keeps the panel; one setting of its own in the registry. */
export function register(st) {
    panelEl = st.shell.panel({ id: 'sweep', title: 'Sweep', help: 'An example add-in: one setting swept against a detector\'s uniformity' })
    st.shell.command({ id: 'sweep', menu: 'Analysis', label: 'Example: sweep a setting', run: () => st.shell.open('sweep') })
    let steps = st.storage.get('steps', 5)
    st.params.provide(() => [{ path: 'steps', label: 'Sweep steps', min: 2, max: 50, step: 1,
                               get: () => steps, set: v => { steps = v; st.storage.set('steps', v) } }])
}

/** Once the page is up: the panel's controls. */
export function start(st) {
    const el = (tag, text) => { const e = document.createElement(tag); if (text != null) e.textContent = text; return e }
    const field = (label, value) => { const i = el('input'); i.value = value; const l = el('label', label + ' '); l.append(i); return [l, i] }
    const [pathL, pathI] = field('Setting', st.storage.get('path', ''))
    const [fromL, fromI] = field('From', '0')
    const [toL, toI] = field('To', '1')
    const [partL, partI] = field('Part (vector)', '')
    const go = el('button', 'Sweep')
    const out = el('pre', '')
    panelEl.append(pathL, fromL, toL, partL, go, out)
    go.addEventListener('click', async () => {
        st.storage.set('path', pathI.value)
        out.textContent = ''
        go.disabled = true
        try {
            const { best } = await sweep(st.script, {
                path: pathI.value.trim(), from: +fromI.value, to: +toI.value, steps: st.params.read(st.params.path('steps')),
                part: partI.value === '' ? null : +partI.value,
                onStep: (r, i, n) => { out.textContent += `${r.value.toPrecision(4)}  U0 ${r.uniformity?.toFixed(3) ?? '-'}  mean ${r.mean?.toPrecision(4) ?? '-'}\n`; st.shell.progress('sweep', { label: 'sweep', done: i + 1, total: n }) },
            })
            out.textContent += `best: ${best.value.toPrecision(4)} (U0 ${best.uniformity?.toFixed(3) ?? '-'}), set`
        } catch (e) { out.textContent += `\n${e.message}` }
        finally { go.disabled = false; st.shell.progress('sweep', null) }
    })
}
