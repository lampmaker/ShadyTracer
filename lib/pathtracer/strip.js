//======================================================================================================================
// A CHART'S OWN STRIP -- the controls that change how a chart shows its data, on the chart.
//
//   const S = chartStrip(panelElement)                 // a thin bar, put first in the panel
//   S.choice('scale', { options: [{ value: 'linear', text: 'lin', tip: 'Linear' }, ...], get, set })
//   S.toggle('rot', { icon: 'rotational', tip: 'Rotational symmetry', get, set })
//   S.select('view', { options: { auto: 'auto', ... } | () => ({...}), get, set, tip })
//   S.input('planes', { get, set, tip, width: 70 })     // typed, applied on Enter or leaving it
//   S.action('download', 'Save as CSV', run)
//   S.gap(); S.spacer()
//   S.show('decades', on)                              // a control that only applies sometimes
//   S.refresh()                                        // every control reads its value again
//
// WHY (UI_PLAN.md section 8's table; what a chart was still to carry -- a pinned reference, direct axis
// zoom -- is section 7's Open list): the charts' settings lived in the Optics panel, far from the chart
// they change -- the log scale of a polar diagram three folders down another panel. What changes how a
// chart DRAWS sits on the chart; what changes the DATA (what feeds it, its grid) needs a new trace and
// stays with the trace. The optics page moved each chart's settings into its Analysis pane (mockup F, the
// user's choice), then back onto each chart in this strip when there could be two maps side by side (the
// user, 2026-10-02: "put the controls for the chart into the chart itself"); lib/shell/example.html draws
// one of every kind of control.
//
// THE USER'S RULES (2026-09-27): minimal; icons with tooltips over words; nothing said twice. So a
// choice of two or three is a segmented row of short words or icons, the chosen one lit -- not a
// dropdown -- and a dropdown is kept for the longer lists. Every control has its tooltip; values are
// said once, by the control itself.
//======================================================================================================================
import { icon, iconButton, lit } from './icons.js'

const BAR = { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 6px', flexWrap: 'wrap', flex: 'none',
              borderBottom: '1px solid var(--sh-line, #2a3138)', background: 'var(--sh-raised, #1d2226)',
              font: '12px var(--sh-sans, system-ui, sans-serif)', color: 'var(--sh-muted, #8fa3b3)', minHeight: '30px', boxSizing: 'border-box' }
/* the segmented row's look, exported: the Renderer panel's Quality presets are one too (settingsui.js) */
export const SEG = { display: 'flex', gap: '1px', padding: '1px', borderRadius: '5px', background: 'rgba(0,0,0,0.25)',
              border: '1px solid rgba(160,175,190,0.16)' }
export const SEGBTN = { font: '12px var(--sh-sans, system-ui, sans-serif)', color: '#b9c4cd', background: 'transparent', border: '0',
                 borderRadius: '4px', padding: '0 8px', height: '22px', cursor: 'pointer', display: 'grid', placeItems: 'center' }
const FIELD = { font: '12px var(--sh-mono, ui-monospace, monospace)', color: 'var(--sh-ink, #dde3e8)', background: 'var(--sh-bg, #0f1214)',
                border: '1px solid var(--sh-line, #2a3138)', borderRadius: '3px', padding: '1px 5px', height: '22px', boxSizing: 'border-box' }

/**
 * @param host  the chart panel's element: the strip is put first in it
 * @returns the strip's builder (see the header)
 */
export function chartStrip(host) {
    const bar = document.createElement('div')
    bar.className = 'chart-strip'
    Object.assign(bar.style, BAR)
    host.insertBefore(bar, host.firstChild)
    const controls = new Map()              // key -> { el, refresh() }
    // data-key: a control found by what it sets, not by its tooltip's wording (a test, a script)
    // display: the control's own (a segmented row and a typed field are flex), for show() to put back
    const add = (key, el, refresh = () => { }) => { el.dataset.key = key; bar.appendChild(el); controls.set(key, { el, refresh, display: el.style.display }); refresh(); return el }
    const safe = f => (...a) => { try { return f(...a) } catch (e) { console.error('[chart strip]', e) } }

    const S = {
        element: bar,
        /** A segmented choice: short words or icons, the chosen one lit. options: [{ value, text | icon, tip }] */
        choice(key, { options, get, set, tip = '' }) {
            const seg = document.createElement('div')
            Object.assign(seg.style, SEG)
            seg.title = tip
            const btns = options.map(o => {
                const b = document.createElement('button')
                b.type = 'button'
                b.title = o.tip ?? o.text ?? String(o.value)
                Object.assign(b.style, SEGBTN)
                if (o.icon) { b.appendChild(icon(o.icon, 15)); b.style.padding = '0 5px' } else b.textContent = o.text ?? String(o.value)
                b.onclick = safe(() => { if (!b.disabled) { set(o.value); S.refresh() } })
                seg.appendChild(b)
                return { b, o }
            })
            return add(key, seg, () => {
                const v = get()
                for (const { b, o } of btns) {
                    lit(b, o.value === v)
                    const off = typeof o.enabled === 'function' && !o.enabled()
                    b.disabled = off; b.style.opacity = off ? '0.35' : '1'; b.style.cursor = off ? 'default' : 'pointer'
                }
            })
        },
        /** An icon that is on or off. */
        toggle(key, { icon: name, tip, get, set }) {
            const b = iconButton(name, tip, safe(() => { set(!get()); S.refresh() }))
            return add(key, b, () => lit(b, !!get()))
        },
        /** A dropdown, for a list too long for a segmented row. options: { label: value } or a function
         *  giving one (rebuilt when its labels change: a list that follows the scene). */
        select(key, { options, get, set, tip = '' }) {
            const sel = document.createElement('select')
            Object.assign(sel.style, FIELD, { font: '12px var(--sh-sans, system-ui, sans-serif)', maxWidth: '220px' })
            sel.title = tip
            let sig = ''
            const values = []
            sel.onchange = safe(() => { set(values[sel.selectedIndex]); S.refresh() })
            return add(key, sel, () => {
                const opts = typeof options === 'function' ? options() : options
                const s = JSON.stringify(Object.entries(opts))
                if (s !== sig) {
                    sig = s
                    sel.innerHTML = ''
                    values.length = 0
                    for (const [label, value] of Object.entries(opts)) {
                        const o = document.createElement('option'); o.textContent = label; sel.appendChild(o); values.push(value)
                    }
                }
                const i = values.indexOf(get())
                if (i >= 0 && sel.selectedIndex !== i) sel.selectedIndex = i
            })
        },
        /** A typed value: applied on Enter or when the field is left, never under the typist's cursor. */
        input(key, { get, set, tip = '', width = 64, prefix = '' }) {
            const wrap = document.createElement('label')
            Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '4px' })
            wrap.title = tip
            if (prefix) { const p = document.createElement('span'); p.textContent = prefix; wrap.appendChild(p) }
            const f = document.createElement('input')
            Object.assign(f.style, FIELD, { width: `${width}px` })
            f.spellcheck = false
            const commit = safe(() => { if (f.value !== String(get())) { set(f.value); S.refresh() } })
            f.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); f.blur() } if (e.key === 'Escape') { f.value = String(get()); f.blur() } }
            f.onblur = commit
            wrap.appendChild(f)
            return add(key, wrap, () => { if (document.activeElement !== f) f.value = String(get()) })
        },
        /** A button that does something once: save, export. */
        action(name, tip, run) {
            const b = iconButton(name, tip, safe(run))
            bar.appendChild(b)
            return b
        },
        /** A thin divider between groups. */
        gap() { const s = document.createElement('span'); Object.assign(s.style, { width: '1px', alignSelf: 'stretch', margin: '3px 2px', background: 'rgba(160,175,190,0.18)' }); bar.appendChild(s) },
        /** Push what follows to the right end. */
        spacer() { const s = document.createElement('span'); s.style.flex = '1'; bar.appendChild(s) },
        /** Show a control only where it applies (the log decades with a log scale). Shown again, it gets its own
         *  display back: '' made a segmented row a block, its words stacked (the optics map's target, 2026-10-02). */
        show(key, on) { const c = controls.get(key); if (c) c.el.style.display = on ? c.display : 'none' },
        /** Every control reads its value again (after a change made elsewhere). */
        refresh() { for (const c of controls.values()) { try { c.refresh() } catch (e) { console.error('[chart strip]', e) } } },
    }
    return S
}

/**
 * SAVE WHAT A PANEL SHOWS AS ONE PNG: every canvas in `root` that is on screen, drawn where it sits,
 * on the chart surface's colour. The charts are separate canvases side by side; a picture of the
 * panel is what a report wants.
 */
export function saveCanvases(root, filename = 'chart.png', background = '#16191c') {
    const r0 = root.getBoundingClientRect()
    const list = [...root.querySelectorAll('canvas')].filter(c => c.offsetParent !== null && c.clientWidth > 0)
    if (!list.length) return false
    const dpr = globalThis.devicePixelRatio || 1
    let w = 0, h = 0
    const at = list.map(c => { const r = c.getBoundingClientRect(); const p = { c, x: r.left - r0.left, y: r.top - r0.top, w: r.width, h: r.height }
                                 w = Math.max(w, p.x + p.w); h = Math.max(h, p.y + p.h); return p })
    const out = document.createElement('canvas')
    out.width = Math.round(w * dpr); out.height = Math.round(h * dpr)
    const g = out.getContext('2d')
    g.fillStyle = background; g.fillRect(0, 0, out.width, out.height)
    for (const p of at) g.drawImage(p.c, p.x * dpr, p.y * dpr, p.w * dpr, p.h * dpr)
    out.toBlob(b => {
        if (!b) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(b); a.download = filename; a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    })
    return true
}

/** Save text as a file (the charts' CSVs). */
export function saveText(text, filename, type = 'text/csv') {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type }))
    a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
