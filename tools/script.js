//======================================================================================================================
// THE SCRIPT PANEL -- the scene's script (builder/model.js SCRIPT, 0.82.0) edited, run and stopped, and what it says.
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
// THE EDITOR IS A TEXTAREA, COLOURED FROM UNDERNEATH. A code editor (completion, folding) is a library the page does
// not have. The textarea's text is transparent, its caret and selection not; under it a layer draws the same text in
// colours (tools/scripthighlight.js), in the same font in the same box, scrolled with it, and beside it the line
// numbers an error names -- that line marked until the next edit. The textarea is still what is typed in: Tab, Ctrl
// Enter, undo and the selection are the browser's own.
//
// THE REFERENCE BESIDE IT (? Reference, tools/scriptrefpane.js): every name a script is handed, found by words, its
// examples put in the editor at the caret. Open or not is remembered in this browser; in a narrow panel it goes under
// the editor rather than beside it.
//======================================================================================================================

import { SCRIPT_EXAMPLES } from './scriptexamples.js'
import { runScript, scriptLocation, formatValue, STOPPED, SCRIPT_NAMES } from './scriptapi.js'
import { highlightJS } from './scripthighlight.js'
import { PARAM_MIME, offsetAt, dropEdit } from './scriptdrop.js'
import { referencePane } from './scriptrefpane.js'

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
    const refB = el('button', 'ref', '? Reference')
    refB.title = 'Every function a script can call -- the analysis\'s numbers among them -- with examples to put in the editor'
    const state = el('span', 'state')
    runB.title = 'Run the scene\'s script (Ctrl Enter in the editor). It runs with the page\'s whole reach: read a script from someone else before running it'
    stopB.title = 'Stop the script at its next await'
    exS.title = 'Put an example in the editor (the script there now is replaced: asked first)'
    bar.append(runB, stopB, exS, clearB, refB, state)
    const ed = el('textarea', 'rt-script-code')
    ed.spellcheck = false
    ed.setAttribute('autocomplete', 'off'); ed.setAttribute('autocapitalize', 'off')
    ed.placeholder = '// JavaScript, run with ▶ Run. The scene\'s settings, camera, renders and analyses:\n'
        + '//   params.list(), params.set(path, v), camera.set({ azimuth: 30 }), await render({ samples: 64 }),\n'
        + '//   await optics.run({ rays: 1e6 }), files.save(name, data), log(...)\n'
        + '// Examples… and ? Reference above.'
    /* the box: the line numbers, the colours, and the textarea over them (see the header) */
    const box = el('div', 'rt-script-edit'), gutter = el('div', 'rt-script-gutter'), colours = el('pre', 'rt-script-hl')
    colours.setAttribute('aria-hidden', 'true')
    box.append(gutter, colours, ed)
    const out = el('div', 'rt-script-out')
    const main = el('div', 'rt-script-main'), body = el('div', 'rt-script-body')
    main.append(box, out)
    const ref = referencePane({ names: SCRIPT_NAMES, insert: code => insertSnippet(code) })
    body.append(main, ref.el)
    host.append(bar, body)
    /* open or not, this browser's choice; beside the editor, or under it in a narrow panel */
    const REF_KEY = 'raytracer.script.reference'
    const showRef = on => {
        host.classList.toggle('ref-open', on)
        refB.classList.toggle('on', on)
        try { globalThis.localStorage?.setItem(REF_KEY, on ? '1' : '0') } catch { }
    }
    let refOn = false
    try { refOn = globalThis.localStorage?.getItem(REF_KEY) === '1' } catch { }
    showRef(refOn)
    refB.addEventListener('click', () => showRef(!host.classList.contains('ref-open')))
    if (globalThis.ResizeObserver) new ResizeObserver(() => host.classList.toggle('narrow', host.clientWidth < 640)).observe(host)
    const GLOBALS = new Set(SCRIPT_NAMES)
    let errorLine = 0, drawn = null, drawnError = -1
    const sync = () => {
        // the textarea's client box leaves its scrollbars out: the colours' box is made that size, so both scroll alike
        colours.style.width = `${ed.clientWidth}px`; colours.style.height = `${ed.clientHeight}px`
        colours.scrollTop = ed.scrollTop; colours.scrollLeft = ed.scrollLeft
        gutter.scrollTop = ed.scrollTop
    }
    const redraw = () => {
        const v = ed.value
        if (v !== drawn) {
            /* a last empty line, and room below: the colours scroll as far as the textarea, whose last line may be empty */
            colours.innerHTML = highlightJS(v, { globals: GLOBALS }) + '\n\n'
            drawn = v
            drawnError = -1
        }
        const lines = v.split('\n').length
        if (gutter.childElementCount !== lines || drawnError !== errorLine) {
            gutter.innerHTML = Array.from({ length: lines }, (_, i) => `<div${i + 1 === errorLine ? ' class="err"' : ''}>${i + 1}</div>`).join('') + '<div>&nbsp;</div><div>&nbsp;</div>'
            drawnError = errorLine
        }
        sync()
    }
    ed.addEventListener('scroll', sync)

    /* A SETTING DROPPED IN (tools/scriptdrop.js): the Parameters panel's row, as its binding or its call, where the pointer
       lets go -- the caret follows the pointer while it is dragged over, so where it will go is seen. The point is a line
       and a column by the editor's own metrics: one font, monospaced, so a column is a width (measured, not assumed). */
    let charW = 0
    const measure = () => {
        if (charW) return charW
        const m = el('span', null, '0'.repeat(40))
        Object.assign(m.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre' })
        colours.append(m)
        charW = m.getBoundingClientRect().width / 40 || 7
        m.remove()
        return charW
    }
    const pointAt = e => {
        const r = ed.getBoundingClientRect(), cs = globalThis.getComputedStyle(ed)
        const lh = parseFloat(cs.lineHeight) || 17, tab = parseInt(cs.tabSize) || 4
        const line = Math.floor((e.clientY - r.top - parseFloat(cs.paddingTop) + ed.scrollTop) / lh)
        const col = (e.clientX - r.left - parseFloat(cs.paddingLeft) + ed.scrollLeft) / measure()
        return offsetAt(ed.value, line, col, { tab })
    }
    const ours = e => [...(e.dataTransfer?.types ?? [])].includes(PARAM_MIME)
    ed.addEventListener('dragover', e => {
        if (!ours(e) || ctrl) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        const at = pointAt(e)
        ed.focus(); ed.setSelectionRange(at.offset, at.offset)
    })
    ed.addEventListener('drop', e => {
        if (!ours(e)) return
        e.preventDefault()
        if (ctrl) return status('a script is running: drop a setting in once it has stopped')
        let item
        try { item = JSON.parse(e.dataTransfer.getData(PARAM_MIME)) } catch { return }
        if (!item?.path) return
        const d = dropEdit(ed.value, pointAt(e), item)
        ed.focus()
        ed.setSelectionRange(d.from, d.to)
        /* through the browser's own insert where it has one, so Ctrl Z takes the drop back; it fires `input` (kept) */
        let done = false
        try { done = document.execCommand?.('insertText', false, d.text) } catch { }
        if (!done) { ed.setRangeText(d.text, d.from, d.to, 'end'); keep() }
        ed.setSelectionRange(d.caret, d.caret)
    })
    if (globalThis.ResizeObserver) new ResizeObserver(sync).observe(ed)

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
        redraw()
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
    ed.addEventListener('input', () => { errorLine = 0; keep() })

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

    /* AN EXAMPLE FROM THE REFERENCE, at the caret: on a line of its own (a line break before it when the caret is in a
       line's text, after it when text follows), through the browser's insert so Ctrl Z takes it back */
    function insertSnippet(code) {
        if (ctrl) return status('a script is running: put an example in once it has stopped')
        const v = ed.value
        const at = ed.selectionEnd                    // a textarea keeps its caret when the focus leaves it
        const start = v.lastIndexOf('\n', at - 1) + 1, end = v.indexOf('\n', at) < 0 ? v.length : v.indexOf('\n', at)
        const before = v.slice(start, at).trim(), after = v.slice(at, end).trim()
        const text = (before ? '\n' : '') + code + (after ? '\n' : '')
        ed.focus()
        ed.setSelectionRange(at, at)
        let done = false
        try { done = document.execCommand?.('insertText', false, text) } catch { }
        if (!done) { ed.setRangeText(text, at, at, 'end'); keep() }
    }

    async function run() {
        if (ctrl) return
        const code = ed.value
        if (!code.trim()) return print('nothing to run: write a script, or take one from Examples…', 'warn')
        ctrl = new AbortController()
        paint()
        t0 = performance.now()
        print(`▶ ${new Date().toLocaleTimeString()}`, 'mark')
        errorLine = 0
        try {
            const r = await runScript(code, api(ctrl.signal, print))
            if (r !== undefined) print(`→ ${formatValue(r)}`, 'result')
            print(`done in ${((performance.now() - t0) / 1000).toFixed(1)} s`, 'mark')
        } catch (e) {
            if (e?.name === STOPPED) print(`■ stopped after ${((performance.now() - t0) / 1000).toFixed(1)} s`, 'warn')
            else {
                const at = scriptLocation(e)
                print(`${e?.name ?? 'Error'}: ${e?.message ?? e}${at ? `  (line ${at.line})` : ''}`, 'error')
                if (at) { errorLine = at.line; selectLine(at.line) }
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
        showScene(text) { if (ed.value !== (text ?? '')) { ed.value = text ?? ''; errorLine = 0; paint() } },
        run, stop,
        get running() { return !!ctrl },
        /** the editor's text, and what was printed: for a test or the console */
        get code() { return ed.value },
        set code(v) { ed.value = String(v ?? ''); keep() },
        output: () => lines.map(l => l.textContent),
    }
}
