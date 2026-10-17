//======================================================================================================================
// THE RENDERER'S SETTINGS AS ROWS OF A PROPERTY TABLE -- what installUI (index.js) fills its folders with.
//
//   const UI = makeSettingsUI({ states, update, onRefresh })
//   UI.addBox(table, RENDERER_BOXES[i])                             // one box of the Renderer panel
//   UI.addGroup(table, 'Exposure', 'Exposure')                      // a whole group's folder (the view's popovers)
//   UI.conditional(folder, { group, showIf, dev })                  // anything else shown on the same rules
//   UI.installDeveloper(table)                                      // the Developer switch in a box of its own,
//                                                                   //   where there is no Quality box to hold it
//   UI.applyVisibility()
//
// WHY ITS OWN MODULE: installUI runs only with a GPU, and the Developer switch is a mode -- "a feature behind
// a flag that nothing exercises is code that has never run" (CLAUDE.md). Here it needs a property table and
// the uniform states and nothing else, so test/renderer.check.mjs builds the Renderer panel's rows in a
// headless browser over the real PropertyTable.
//
// THE RENDERER PANEL IN BOXES (the user, 2026-10-04: "separate it in groups with boxed outlines, like the analysis
// settings ... lightsources should have their own box ... main goal is to make it easier to switch between quick
// preview mode and accurate render mode; now it's just too hard to find (and understand) the right settings").
// It was one Tracing folder of twenty rows in the schema's order -- the march's tolerance beside the bounces, the
// photon shares beside the firefly clamp -- with the presets in a dropdown at its top. Now (RENDERER_BOXES):
//   Quality          the presets as buttons, Preview (Sketch, Draft) and Accurate (Standard, High) and Optics,
//                    and a line saying what the one in force traces, or what Custom changed (quality.js describe);
//                    at its foot, on one line, the Developer switch, what it hides that has moved, and Reset
//   Light sources    the environment, the two kinds of light tracing, their photons -- each a switch -- and,
//                    for a developer, light sampling, the photon map and the glowing surfaces' search
//   Paths and noise  the bounces, the firefly clamp; for a developer roulette and the averaging
//   Render size      installUI's own
//   Ray marching, Performance, Diagnostics   a developer's alone -- Performance (the user, 2026-10-07: "a special
//                    section ... to test/optimize all the render & compile stuff"): how the scene is built, each switch
//                    a different build, its help on hover, and a row greyed while what it needs is off
// A switch is a checkbox (a 0..1 slider was a number to drag), and every row carries its schema's help as a tooltip.
//======================================================================================================================

import { GROUP_PARAMS } from './params.js'
import { QUALITY_PRESETS, QUALITY_GROUPS, applyPreset, devChanged, devDefaults, describe } from './quality.js'
import { icon, lit } from './icons.js'
import { SEG, SEGBTN } from './strip.js'

const DEV_KEY = 'pathtracer.developer'
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/* THE BOXES, top to bottom. WHAT A BOX HOLDS IS ITS OWN LIST, not a schema group: a group is its settings'
   parameter path (params.js GROUP_PARAMS -- ids a timeline track or a saved file keeps), and moving a setting to
   another group to move it to another box would move its id. A row is a setting's key, or { key, label, invert, scale }
   where the panel says it differently (`scale`: shown times it -- a length in metres shown in um); a { title, rows } inside a box is a folder of its own. A box, folder or row
   whose every setting is a developer's goes with the Developer switch (gui.dev); `dev` on a box says so outright.
   `own`: the rows are installUI's, not settings (the render size). `page`: where the box goes when the host
   places no section of that title (installUI's pages). `developer`: the Developer switch's line at the box's foot
   -- in Quality, at the top of the panel (the user, 2026-10-04: "put the developer settings toggle & reset at the
   top, in the quality box ... on a single line"), where it was a box of its own at the bottom.
   THE LIGHT SOURCES' SWITCHES: the scene's environment (lamps only, inverted: ticked is lit), the sun's and the
   glowing surfaces' caustics (lt), the lights' rays (lightRays) -- each a kind of light, and whether it is traced. */
export const RENDERER_BOXES = [
    { title: 'Quality', icon: 'bolt', page: 'Sampling', quality: true, rows: ['opticsFlat', 'moveFast', 'moveMode'], developer: true },
    { title: 'Light sources', icon: 'sun', page: 'Sampling', rows: [
        { key: 'lampsOnly', label: 'Sun, sky or studio', invert: true },
        'lt', 'lightRays', 'ltPhotons', 'sppm',
        { title: 'Light sampling', rows: ['nee', 'neeEmitShare', 'neeSunPick'] },
        { title: 'Photon map', rows: ['ltEmitShare', 'ltLearn', 'ltRadius', 'sppmRadius', 'sppmCapacity'] },
        { title: 'Glowing surfaces (emitters)', rows: ['emitRadius', 'emitMargin', 'draftSeek'] },
    ] },
    { title: 'Paths and noise', icon: 'bounce', page: 'Sampling', rows: ['maxbounce', 'fireflyClamp', 'rr', 'maxaverages', 'moveAverages'] },
    { title: 'Render size', icon: 'image', page: 'Sampling', own: true },
    /* THE SURFACE TOLERANCE IS THE SCENE'S since 0.63.0 (its Properties, in its unit: builder/panel.js); the box's line
       still says the one in use, and how it was chosen. Its row was here, in micrometres (a row's `scale`, which stays for
       any other). */
    { title: 'Ray marching', icon: 'march', page: 'Advanced', line: 'tolerance', rows: ['maxiter', 'stepscale', 'fastnormals', 'normallimit'] },
    /* HOW THE SCENE IS BUILT (0.30.0; the user, 2026-10-07: "a special section in the render settings (now everything is
       under ray marching) to test/optimize all the render & compile stuff ... with a tooltip (hover) section explaining;
       make sure that things that don't work together cannot be switched on both"). Each a different build since 0.29.0
       -- off is not in the kernels at all -- so the box says so at its top; each row's help is its tooltip, and a row
       whose `requires` is off is greyed (the cache's fill, cells and view without the cache). */
    { title: 'Performance', icon: 'boxes', page: 'Advanced',
      intro: 'How much of the GPU a frame takes, then how the scene is built for it. Each switch after the first row is a'
          + ' different build: turning one compiles again (the compile bar shows it), and a feature switched off is not in'
          + ' the kernels at all. A greyed row needs the one named in its tooltip. Hover a row for what it does; Tests has'
          + ' a bench for each build.',
      /* sliceMs FIRST (0.58.0): not a build, but the one row here a user with a heavy scene needs -- the GPU time a
         live frame takes (raytrace_main.js A SAMPLE OVER SEVERAL FRAMES) */
      rows: ['sliceMs', 'sceneBake', 'sceneData', 'stepCache', 'stepCacheFill', 'stepCacheCells', 'stepCacheView'] },
    { title: 'Diagnostics', icon: 'tune', page: 'Advanced', dev: true, rows: ['envUniform'] },
]

/* A SWITCH: a whole number that is 0 or 1 -- a checkbox, not a slider from 0 to 1 */
const isSwitch = sp => sp?.type === 'u32' && !sp.gui?.options && sp.gui?.min === 0 && sp.gui?.max === 1 && sp.gui?.step === 1

/** A box's heading icon: the folder's `--ic`, as a mask the host's stylesheet draws before the title
 *  (lib/shell/shell.css .shell-boxes). Inline, so a popped-out window keeps it. Nothing without a stylesheet. */
export function boxIcon(folder, name) {
    const el = folder?.element
    if (!el || !name || !el.classList?.contains('tp-fldv')) return folder      // the table itself: an untitled section
    const svg = icon(name).outerHTML.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    el.dataset.icon = name
    el.style.setProperty('--ic', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`)
    return folder
}

/**
 * @param states     { [group]: { spec, values } } -- the renderer's uniform states (index.js)
 * @param update     (reset) => void -- rebuild the uniforms; restart the render if reset and they changed
 * @param onRefresh  () => void -- the host's refresh, so every table re-reads what changed
 * @param omit       settings the host shows its own way (the view's mode, as icons)
 * @param storage    where the Developer switch is remembered (localStorage; a stand-in in a test)
 */
export function makeSettingsUI({ states, update, onRefresh = () => { }, omit = [], storage = globalThis.localStorage, lines = {} } = {}) {
    const skip = new Set(omit)
    const flat = () => Object.assign({}, ...Object.values(states).map(s => s.values))
    const stateOf = k => Object.values(states).find(s => k in s.values)
    const groupOf = k => Object.keys(states).find(g => k in states[g].values)
    const resetOf = (group, k) => { const r = GROUP_PARAMS[group]?.reset ?? true; return typeof r === 'function' ? r(k) : r }

    /* THE DEVELOPER SWITCH, remembered per browser: a developer turns it on once. A storage that throws
       (a private window, blocked site data) is a switch that starts off, never a panel that fails. */
    const DEV = { on: false }
    try { DEV.on = storage?.getItem(DEV_KEY) === '1' } catch { }
    const saveDev = () => { try { storage?.setItem(DEV_KEY, DEV.on ? '1' : '0') } catch { } }

    /* SHOWN ONLY WHERE THEY APPLY: gui.showIf (a setting of the same group has one of the values) and
       gui.dev (the Developer switch is on), as ONE rule -- Tweakpane's refresh calls this again, and two
       rules applied one after the other would let the second undo the first. Re-applied after every
       change and every refresh, so a value set from a script or the bench shows the right rows -- and the
       Quality box's buttons and line repainted with them, which is how the toolbar's ⚡ and the Render
       menu's presets reach it. */
    const rules = []                    // [control, { group, showIf, dev }]
    const conditional = (c, rule) => { if (c) rules.push([c, rule]) }
    /* ...AND USABLE ONLY WHERE WHAT THEY NEED IS ON (gui.requires: keys of any group that must not be 0): greyed and
       fixed otherwise, the tooltip naming what to switch on -- so two settings that do not work together cannot both
       be switched on from here (the step cache's cells without the cache, which the renderer would ignore) */
    const needs = []                    // [control, requires, help]
    const labelOf = k => { const st = stateOf(k); return st?.spec[k]?.gui?.label ?? k }
    const painters = []
    const applyVisibility = () => {
        for (const [c, { group, showIf, dev }] of rules) {
            const v = group ? states[group]?.values ?? {} : {}
            const shown = (!dev || DEV.on) && (!showIf || Object.entries(showIf).every(([k, vals]) => vals.includes(v[k] | 0)))
            try { c.hidden = !shown } catch { }
        }
        const all = flat()
        for (const [c, requires, help] of needs) {
            const off = requires.filter(k => (all[k] | 0) === 0)
            try {
                if (c.disabled !== (off.length > 0)) c.disabled = off.length > 0
                const tip = [help, off.length ? `Needs ${off.map(labelOf).join(' and ')} on.` : ''].filter(Boolean).join('\n\n')
                if (c.element.title !== tip) c.element.title = tip
            } catch { }
        }
        for (const p of painters) try { p() } catch (e) { console.error('[settings]', e) }
    }
    const refreshAll = () => { applyVisibility(); onRefresh() }

    /* ONE SETTING'S ROW. A switch is a checkbox over a stand-in that reads and writes the 0 or 1 -- inverted for a
       row that says the setting the other way round (lamps only as "Sun, sky or studio", ticked) -- and writes only
       a change: Tweakpane's refresh writes the shown value back through the setter. The schema's help is the
       row's tooltip; gui.showIf, gui.dev and gui.help are taken off before Tweakpane sees the options. */
    const addRow = (folder, group, k, { label, invert = false, scale = 0 } = {}) => {
        const sp = states[group].spec[k], vals = states[group].values
        const { showIf, dev, help, requires, ...gui } = sp.gui
        let c
        /* A ROW IN ANOTHER UNIT (`scale`): a stand-in shows the setting times it, its range and step too, and writes it
           back divided -- only a change of more than half a step, since Tweakpane's refresh writes the shown value back
           rounded to the step, and that rounding must not become the setting */
        if (scale > 0) {
            const box = {}, half = (gui.step ?? 0) * scale / 2
            Object.defineProperty(box, 'v', {
                enumerable: true,
                get: () => +vals[k] * scale,
                set: v => { if (Math.abs(+vals[k] * scale - v) > half) vals[k] = v / scale },
            })
            const scaled = Object.fromEntries(['min', 'max', 'step'].filter(f => gui[f] != null).map(f => [f, gui[f] * scale]))
            c = folder.addBinding(box, 'v', Object.assign({}, gui, scaled, { label: label ?? gui.label ?? k }))
        } else if (invert || isSwitch(sp)) {
            const box = {}
            Object.defineProperty(box, 'on', {
                enumerable: true,
                get: () => !!(vals[k] | 0) !== invert,
                set: b => { const v = !!b !== invert ? 1 : 0; if ((vals[k] | 0) !== v) vals[k] = v },
            })
            c = folder.addBinding(box, 'on', { label: label ?? gui.label ?? k })
        } else c = folder.addBinding(vals, k, Object.assign({ label: k }, gui, label ? { label } : {}))
        const r = resetOf(group, k)
        c.on('change', () => { update(r); applyVisibility() })
        if (help) try { c.element.title = help } catch { }
        if (showIf || dev) conditional(c, { group, showIf, dev })
        if (requires?.length) needs.push([c, requires, help])
        return !!dev
    }

    /* A LIST OF ROWS into a folder, a nested { title, rows } its own folder: how many rows went in, and how many
       of them were a developer's -- a folder of a developer's rows alone goes with the switch whole */
    const fill = (folder, rows) => {
        let n = 0, devs = 0
        for (const r of rows) {
            if (r && typeof r === 'object' && r.rows) {
                const sub = folder.addFolder({ title: r.title })
                const m = fill(sub, r.rows)
                if (!m.n) { try { folder.remove(sub) } catch { } continue }
                if (m.devs === m.n) conditional(sub, { dev: true })
                n += m.n; devs += m.devs
                continue
            }
            const { key, ...o } = typeof r === 'string' ? { key: r } : r
            const g = groupOf(key)
            if (!g || skip.has(key) || !states[g].spec[key]?.gui) continue    // no gui block: plumbing, not a setting
            if (addRow(folder, g, key, o)) devs++
            n++
        }
        return { n, devs }
    }

    /* THE QUALITY BUTTONS: the presets (quality.js) as segmented rows, the one in force lit, none for Custom -- in a
       separator blade, because Tweakpane places each blade by its index among the folder's children and an element
       of our own in between would shift every row after it. Under them, what the choice traces (describe). They
       are renderMode's control: that setting gets no row of its own, since Sketch and Draft are what it means. */
    const addQuality = folder => {
        const blade = folder.addBlade({ view: 'separator' })
        const el = blade.element
        el.replaceChildren()
        Object.assign(el.style, { padding: '4px 4px 2px', height: 'auto' })
        const row = document.createElement('div')
        // tight enough that the three pills fit one line of the panel's default 330 px; narrower, they wrap
        Object.assign(row.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px' })
        const btns = []
        for (const g of QUALITY_GROUPS) {
            const col = document.createElement('div')
            const cap = document.createElement('div')
            cap.textContent = g.title || ' '
            Object.assign(cap.style, { font: '10.5px var(--sh-sans, system-ui, sans-serif)', letterSpacing: '0.06em', textTransform: 'uppercase',
                                       color: 'var(--sh-muted, #8fa3b3)', margin: '0 0 2px 2px' })
            const seg = document.createElement('div')
            Object.assign(seg.style, SEG)
            for (const { id, short } of g.presets) {
                const p = QUALITY_PRESETS.find(q => q.id === id)
                const b = document.createElement('button')
                b.type = 'button'
                b.textContent = short
                b.title = `${p.label}: ${p.help}`
                b.dataset.preset = id
                Object.assign(b.style, SEGBTN, { padding: '0 7px' })
                b.onclick = () => choose(id)
                seg.appendChild(b)
                btns.push(b)
            }
            col.append(cap, seg)
            row.appendChild(col)
        }
        const line = document.createElement('div'), note = document.createElement('div')
        for (const [d, colour] of [[line, 'var(--sh-muted, #8fa3b3)'], [note, 'var(--sh-warn, #d9a226)']])
            Object.assign(d.style, { font: '12px/1.35 var(--sh-sans, system-ui, sans-serif)', color: colour, margin: '6px 2px 2px', whiteSpace: 'normal' })
        line.className = 'quality-line'
        note.className = 'quality-note'
        el.append(row, line, note)
        /* WRITES ONLY WHAT DIFFERS, as the dropdown it replaced: a preset already in force is no restart */
        /* ...the one rule (quality.js applyPreset) the view's Quality menu shares */
        const choose = id => {
            const wrote = applyPreset(id, flat(), diff => {
                for (const [k, v] of Object.entries(diff)) { const st = stateOf(k); if (st) st.values[k] = v }
            })
            if (Object.keys(wrote).length) { update(true); refreshAll() } else applyVisibility()
        }
        painters.push(() => {
            const d = describe(flat())
            for (const b of btns) { lit(b, b.dataset.preset === d.id); b.setAttribute('aria-pressed', String(b.dataset.preset === d.id)) }
            if (line.textContent !== d.text) line.textContent = d.text
            if (note.textContent !== d.note) { note.textContent = d.note; note.style.display = d.note ? '' : 'none' }
        })
        return blade
    }

    /* A BOX'S OWN WORD AT ITS TOP (RENDERER_BOXES `intro`): a muted paragraph in a separator blade, as the Quality line
       is (addQuality says why a blade), and the box's title's tooltip too */
    const addIntro = (folder, text) => {
        const blade = folder.addBlade({ view: 'separator' })
        const el = blade.element
        el.replaceChildren()
        Object.assign(el.style, { padding: '4px 4px 2px', height: 'auto' })
        const p = document.createElement('div')
        p.className = 'box-intro'
        p.textContent = text
        Object.assign(p.style, { font: '12px/1.35 var(--sh-sans, system-ui, sans-serif)', color: 'var(--sh-muted, #8fa3b3)', margin: '2px 2px 4px', whiteSpace: 'normal' })
        el.append(p)
        try { folder.element.querySelector('.tp-fldv_t').title = text } catch { }
        return blade
    }

    /**
     * One box of the Renderer panel (RENDERER_BOXES): a folder with its icon, the Quality buttons first if it is
     * that box, then its rows. Hidden with the Developer switch if every row is a developer's or the box says so.
     * @returns the folder
     */
    /* A BOX'S LIVE LINE (RENDERER_BOXES `line`): a muted paragraph at its top, as the intro, but painted afresh with
       the rest -- what the host says through `lines[name]` (the facade: the surface tolerance in use, which the panel
       cannot work out, the automatic one being the scene's). No such function, no line. */
    const addLine = (folder, fn) => {
        const blade = folder.addBlade({ view: 'separator' })
        const el = blade.element
        el.replaceChildren()
        Object.assign(el.style, { padding: '4px 4px 2px', height: 'auto' })
        const p = document.createElement('div')
        p.className = 'box-line'
        Object.assign(p.style, { font: '12px/1.35 var(--sh-sans, system-ui, sans-serif)', color: 'var(--sh-muted, #8fa3b3)', margin: '2px 2px 4px', whiteSpace: 'normal' })
        el.append(p)
        painters.push(() => { const t = String(fn() ?? ''); if (p.textContent !== t) p.textContent = t })
        return blade
    }
    const addBox = (table, box) => {
        const folder = boxIcon(table.addFolder({ title: box.title }), box.icon)
        if (box.quality) addQuality(folder)
        if (box.intro) addIntro(folder, box.intro)
        if (box.line && typeof lines[box.line] === 'function') addLine(folder, lines[box.line])
        const m = fill(folder, box.rows ?? [])
        if (box.developer) developerLine(folder)
        if (box.dev || (!box.quality && !box.developer && m.n && m.devs === m.n)) conditional(folder, { dev: true })
        return folder
    }

    /**
     * One group's folder, a row per setting with a control, in the schema's order -- the view's popovers (Show,
     * Exposure), where a folder is a group. A folder whose every row is a developer's goes with the switch whole.
     * @returns the folder
     */
    const addGroup = (table, title, group) => {
        const folder = table.addFolder({ title })
        const m = fill(folder, Object.keys(states[group].spec).filter(k => groupOf(k) === group))
        if (m.n && m.devs === m.n) conditional(folder, { dev: true })
        return folder
    }

    /* WHAT THE RESET PUTS BACK: every developer setting not at its default, written only where it differs */
    const resetDev = () => {
        let changed = false
        for (const [k, v] of Object.entries(devDefaults())) {
            const st = stateOf(k)
            if (st && !same(st.values[k], v)) { st.values[k] = v; changed = true }
        }
        if (changed) { update(true); refreshAll() } else applyVisibility()
    }

    /**
     * THE DEVELOPER LINE, one line in a folder: the switch; which developer settings are not at their default -- a
     * hidden row would otherwise hide that a workspace or the console moved it -- as a count, named in its tooltip
     * and in the warning colour while the switch hides them; and Reset, greyed with nothing to put back. In a
     * separator blade, as the Quality buttons are (addQuality says why), and repainted with the visibility, so the
     * switch turned from a host command and a value moved from a script both show.
     */
    const developerLine = folder => {
        const blade = folder.addBlade({ view: 'separator' })
        const el = blade.element
        el.replaceChildren()
        Object.assign(el.style, { padding: '4px 4px 2px', height: 'auto' })
        const row = document.createElement('div')
        row.className = 'dev-line'
        Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px', minHeight: '24px', paddingTop: '5px',
                                   borderTop: '1px solid var(--sh-line, #2a3138)', font: '12px var(--sh-sans, system-ui, sans-serif)' })
        const label = document.createElement('label')
        Object.assign(label.style, { display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--sh-ink, #dde3e8)', cursor: 'pointer',
                                     whiteSpace: 'nowrap', flex: 'none' })
        const box = document.createElement('input')
        box.type = 'checkbox'
        box.style.margin = '0'
        // the panel's own dark, whatever page it is in (a popped-out window, a host without the shell's colour scheme)
        Object.assign(box.style, { accentColor: 'var(--sh-accent, #7896af)', colorScheme: 'dark' })
        box.onchange = () => { DEV.on = box.checked; saveDev(); refreshAll() }
        label.append(box, 'Developer settings')
        const info = document.createElement('span')
        info.className = 'dev-info'
        Object.assign(info.style, { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
        const reset = document.createElement('button')
        reset.type = 'button'
        reset.textContent = 'Reset'
        reset.title = 'Put every developer setting back to its default'
        Object.assign(reset.style, SEGBTN, { flex: 'none', border: '1px solid var(--sh-line, #2a3138)', background: 'var(--tp-button-background-color, #2a3640)' })
        reset.onclick = () => { if (!reset.disabled) resetDev() }
        row.append(label, info, reset)
        el.append(row)
        painters.push(() => {
            if (box.checked !== DEV.on) box.checked = DEV.on
            const c = devChanged(flat())
            const text = c.length ? `${c.length} not at default` : 'all at default'
            if (info.textContent !== text) info.textContent = text
            info.title = c.length ? `Not at their default: ${c.join(', ')}` : 'Every developer setting is at its default'
            info.style.color = c.length && !DEV.on ? 'var(--sh-warn, #d9a226)' : 'var(--sh-muted, #8fa3b3)'
            reset.disabled = !c.length
            reset.style.opacity = c.length ? '1' : '0.4'
            reset.style.cursor = c.length ? 'pointer' : 'default'
        })
        return blade
    }

    /**
     * THE DEVELOPER SWITCH IN A BOX OF ITS OWN, for a host that places no Quality box (whose foot holds it in the
     * Renderer panel): the same line. `folders` are whole folders that are a developer's.
     */
    const installDeveloper = (table, { folders = [] } = {}) => {
        for (const f of folders) conditional(f, { dev: true })
        if (!table) return null
        const f = boxIcon(table.addFolder({ title: 'Developer' }), 'code')
        developerLine(f)
        return f
    }

    return {
        addBox, addGroup, conditional, applyVisibility, installDeveloper,
        developer: () => DEV.on,
        /** Turn the switch, as the checkbox does (a host command, the check). */
        setDeveloper(on) { DEV.on = !!on; saveDev(); refreshAll() },
    }
}
