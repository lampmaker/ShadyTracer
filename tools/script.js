//======================================================================================================================
// THE SCRIPT PANEL -- the scene's script (builder/model.js SCRIPT, 0.next) edited, run and stopped, and what it says.
//
//   const S = installScript(el, { scene: { script(), keep(text) }, api: signal => makeScriptApi({ ... }) })
//   S.showScene(text)      // the scene shown changed: its script in the editor
//   S.run()  S.stop()      // what ▶ and ■ do; S.running
//
// RUN ONLY WHEN ASKED. A scene is a file people pass around, and its script is code with the page's whole reach (it
// can read the projects kept in this browser, write files, make requests). So nothing here runs it but ▶ Run (or
// Ctrl Enter in the editor): not showing a scene, not opening one, not a reload. A scene with a script says so on the
// panel's line, so one that came in a file is seen before it is run.
//
// WHAT IS TYPED IS KEPT AT ONCE (scene.keep at every input, the timeline's way): into the scene the renderer shows,
// whose parameters the script names. Kept later, a keep due when another scene was shown would have gone into that one.
//
// THE EDITOR IS A TEXTAREA. A code editor (highlighting, completion) is a library the page does not have; a textarea
// with Tab and Ctrl Enter is enough to write a loop in, and the error line says where a script failed.
//======================================================================================================================

import { SCRIPT_EXAMPLES } from './scriptexamples.js'
import { runScript, scriptLocation, formatValue, STOPPED } from './scriptapi.js'

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }

/**
 * @param host      the panel's element
 * @param scene     { script() -> the scene shown's script, keep(text) -> whether it was kept }
 * @param api       (signal, log) => the API a run is handed (tools/scriptapi.js makeScriptApi)
 * @param status    (text) => the page's status line, optional
 */
export function installScript(host, { scene, api, status = () => { } }) {
    host.classList.add('rt-script')
    const bar = el('div', 'rt-script-bar')
    const runB = el('button', 'run', '▶ Run'), stopB = el('button', 'stop', '■ Stop')
    const exS = el('select', 'examples')
    const option = (text, value) => { const o = el('option', null, text); o.value = value; return o }
    exS.append(option('Examples…', ''), ...SCRIPT_EXAMPLES.map(x => option(x.label, x.id)))
    const clearB = el('button', 'clear', 'Clear output')
    const state = el('span', 'state')
    runB.title = 'Run the scene\'s script (Ctrl Enter in the editor). It runs with the page\'s whole reach: read a script from someone else before running it'
    stopB.title = 'Stop the script at its next await'
    exS.title = 'Put an example in the editor (the script there now is replaced: asked first)'
    bar.append(runB, stopB, exS, clearB, state)
    const ed = el('textarea', 'rt-script-code')
    ed.spellcheck = false
    ed.setAttribute('autocomplete', 'off'); ed.setAttribute('autocapitalize', 'off')
    ed.placeholder = '// JavaScript, run with ▶ Run. The scene\'s settings, camera, renders and analyses:\n'
        + '//   params.list(), params.set(path, v), camera.set({ azimuth: 30 }), await render({ samples: 64 }),\n'
        + '//   await optics.run({ rays: 1e6 }), files.save(name, data), log(...)\n'
        + '// Examples… above; Help › Scripts for all of it.'
    const out = el('div', 'rt-script-out')
    host.append(bar, ed, out)

    let ctrl = null, t0 = 0
    const lines = []
    const MAX_LINES = 2000
    const print = (text, kind = 'log') => {
        const line = el('div', `line ${kind}`, text)
        out.append(line)
        lines.push(line)
        if (lines.length > MAX_LINES) lines.shift().remove()
        out.scrollTop = out.scrollHeight
    }
    const paint = () => {
        const running = !!ctrl
        runB.disabled = running; stopB.disabled = !running; exS.disabled = running
        state.textContent = running ? 'running…' : ed.value.trim() ? 'this scene has a script' : 'no script in this scene'
        host.classList.toggle('running', running)
    }

    /* the editor: Tab and Shift Tab indent and outdent, Ctrl (or ⌘) Enter runs */
    ed.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); return }
        if (e.key !== 'Tab') return
        e.preventDefault()
        const { selectionStart: a, selectionEnd: b, value: v } = ed
        const from = v.lastIndexOf('\n', a - 1) + 1
        if (a === b && !e.shiftKey) { ed.setRangeText('    ', a, b, 'end') }
        else {
            const to = b > a && v[b - 1] === '\n' ? b - 1 : b
            const block = v.slice(from, to)
            const next = e.shiftKey ? block.replace(/^( {1,4}|\t)/gm, '') : block.replace(/^/gm, '    ')
            ed.setRangeText(next, from, to, 'select')
        }
        keep()
    })
    // the editor's own keys stay the editor's: the page's shortcuts (Delete, Ctrl Z on the scene) are not for here
    for (const k of ['keydown', 'keyup', 'keypress']) ed.addEventListener(k, e => e.stopPropagation())
    const keep = () => { if (!scene.keep(ed.value)) status('the script is not kept: no scene of the project is shown') ; paint() }
    ed.addEventListener('input', keep)

    exS.addEventListener('change', () => {
        const x = SCRIPT_EXAMPLES.find(e => e.id === exS.value)
        exS.value = ''
        if (!x) return
        if (ed.value.trim() && ed.value !== x.code && !globalThis.confirm(`Replace the script in the editor with the example '${x.label}'?`)) return
        ed.value = x.code
        keep()
        ed.focus()
    })
    clearB.addEventListener('click', () => { out.replaceChildren(); lines.length = 0 })

    async function run() {
        if (ctrl) return
        const code = ed.value
        if (!code.trim()) return print('nothing to run: write a script, or take one from Examples…', 'warn')
        ctrl = new AbortController()
        paint()
        t0 = performance.now()
        print(`▶ ${new Date().toLocaleTimeString()}`, 'mark')
        try {
            const r = await runScript(code, api(ctrl.signal, print))
            if (r !== undefined) print(`→ ${formatValue(r)}`, 'result')
            print(`done in ${((performance.now() - t0) / 1000).toFixed(1)} s`, 'mark')
        } catch (e) {
            if (e?.name === STOPPED) print(`■ stopped after ${((performance.now() - t0) / 1000).toFixed(1)} s`, 'warn')
            else {
                const at = scriptLocation(e)
                print(`${e?.name ?? 'Error'}: ${e?.message ?? e}${at ? `  (line ${at.line})` : ''}`, 'error')
                if (at) selectLine(at.line)
                console.error('[script]', e)
            }
        } finally { ctrl = null; paint() }
    }
    const stop = () => { ctrl?.abort(); paint() }
    /* the line an error names, selected in the editor: where to look */
    const selectLine = n => {
        const v = ed.value
        let a = 0
        for (let i = 1; i < n && a >= 0; i++) a = v.indexOf('\n', a) + 1
        if (a < 0) return
        const b = v.indexOf('\n', a)
        ed.setSelectionRange(a, b < 0 ? v.length : b)
    }
    runB.addEventListener('click', run)
    stopB.addEventListener('click', stop)

    ed.value = scene.script() ?? ''
    paint()
    return {
        /** the scene shown changed: its script in the editor (a run goes on: it is the person's to stop) */
        showScene(text) { if (ed.value !== (text ?? '')) { ed.value = text ?? ''; paint() } },
        run, stop,
        get running() { return !!ctrl },
        /** the editor's text, and what was printed: for a test or the console */
        get code() { return ed.value },
        set code(v) { ed.value = String(v ?? ''); keep() },
        output: () => lines.map(l => l.textContent),
    }
}
