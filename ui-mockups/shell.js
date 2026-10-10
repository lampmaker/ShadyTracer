//======================================================================================================================
// THE SHELL MOCKUP (e-shell.html) -- the chosen direction, working: a docking layout (dockview) with
// presets, and the registries the real application would be built on.
//
// THE POINT OF THIS FILE IS ITS SHAPE, as much as what it draws. Everything the user can reach is an
// entry in a registry, and the menus, the presets, the command palette and the help are generated
// from them, never written by hand:
//   PANELS       what can be docked: its module (renderer / optics / builder / app), its help text
//   PARAMS       every value that can be read and set by a PATH -- the contract lib/timeline's
//                registry already has (id, label, min, max, step, options, get, set), so the timeline,
//                an optimiser, the command palette and a script all drive the same thing
//   QUANTITIES   what a chart can show: intensity, CCT, CIE x / y, ... -- a chart picks one; a new
//                quantity is one entry, not a new chart
//   LIBRARY      objects, materials and lights, built in and the user's own, searched and dragged
//   COMMANDS     every action: its label, its shortcut, its menu, its help
//   PRESETS      layouts: which panels, where
// A feature is added by adding entries. Nothing here renders or traces: the picture is a sketch and
// the charts are the repo's own chart code on synthetic data (mock.js).
//======================================================================================================================
import { charts, mountAll, drawPicture, R, CURVES, STATS, MAP, PT } from './mock.js'
import { drawPolar } from '../lib/pathtracer/optics/polar.js'
import { drawCartesian } from '../lib/pathtracer/optics/cartesian.js'
import { drawHeatmap } from '../lib/pathtracer/optics/heatmap.js'
import { isolux } from '../lib/pathtracer/optics/illum.js'
import { turbo } from '../lib/pathtracer/optics/detmap.js'

const { createDockview, themeDark } = window.dockview
const $ = (sel, root = document) => root.querySelector(sel)
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild }

//----------------------------------------------------------------------------------------------------------------------
// PARAMETERS -- one registry, addressed by path. The timeline's contract plus a unit and a module.
//----------------------------------------------------------------------------------------------------------------------
export const PARAMS = new Map()
const param = p => { PARAMS.set(p.id, { step: 0.1, ...p }); return p }
param({ id: 'scene/Lens/back radius', label: 'back radius', unit: 'mm', min: -30, max: -5, value: -15.5, module: 'builder', tune: true })
param({ id: 'scene/Lens/front radius', label: 'front radius', unit: 'mm', min: 4, max: 20, value: 8, module: 'builder', tune: true })
param({ id: 'scene/Lens/position/z', label: 'position z', unit: 'mm', min: 5, max: 20, value: 12, module: 'builder', tune: false })
param({ id: 'scene/Lens/diameter', label: 'diameter', unit: 'mm', min: 4, max: 30, value: 10, module: 'builder' })
param({ id: 'scene/Lens/thickness', label: 'centre thickness', unit: 'mm', min: 1, max: 8, value: 3.2, module: 'builder' })
param({ id: 'scene/LED die/flux', label: 'flux', unit: 'lm', min: 1, max: 500, value: 100, module: 'builder' })
param({ id: 'scene/LED die/CCT', label: 'CCT', unit: 'K', min: 1800, max: 10000, step: 10, value: 4000, module: 'builder' })
param({ id: 'render/view/exposure', label: 'exposure EV100', unit: 'EV', min: -6, max: 20, value: 9.2, module: 'renderer' })
param({ id: 'scene/Environment/sun elevation', label: 'sun elevation', unit: '°', min: -90, max: 90, value: 45, module: 'builder' })
param({ id: 'optics/trace/rays', label: 'rays drawn', min: 1, max: 20000, step: 1, value: 2000, module: 'optics' })
param({ id: 'optics/far field/gamma step', label: 'γ step', unit: '°', options: { 0.25: 0.25, 0.5: 0.5, 1: 1, 2: 2, 5: 5 }, value: 1, module: 'optics' })

//----------------------------------------------------------------------------------------------------------------------
// QUANTITIES a chart can show. `of` says which charts can; `colour` ones need the colour tallies
// (the detector hits carry X and Z already; the far-field grid would need two more tallies a bin).
//----------------------------------------------------------------------------------------------------------------------
export const QUANTITIES = [
    { id: 'I', label: 'Intensity', unit: 'cd', of: ['intensity'] },
    { id: 'Iklm', label: 'Intensity per klm', unit: 'cd/klm', of: ['intensity'] },
    { id: 'E', label: 'Illuminance, traced', unit: 'lx', of: ['illuminance'] },
    { id: 'CCT', label: 'CCT', unit: 'K', of: ['intensity', 'illuminance'], colour: true },
    { id: 'x', label: 'CIE x', unit: '', of: ['intensity', 'illuminance'], colour: true },
    { id: 'y', label: 'CIE y', unit: '', of: ['intensity', 'illuminance'], colour: true },
    { id: 'duv', label: "Δu'v' from the mean", unit: '', of: ['intensity', 'illuminance'], colour: true },
]
/* synthetic colour over angle and over the map: the classic phosphor LED, bluer on the axis and
   yellower towards the edge of the beam */
const colourAt = (id, t) => {                       // t: 0 on the axis / at the centre, 1 at the edge
    const cct = 5200 - 1300 * t * t
    return id === 'CCT' ? cct : id === 'x' ? 0.334 + 0.05 * t * t : id === 'y' ? 0.345 + 0.04 * t * t : 0.0045 * t * t
}

//----------------------------------------------------------------------------------------------------------------------
// THE LIBRARY: built in, the user's own, and the project's. Grows to hundreds: searched, filtered,
// dragged -- not a dropdown.
//----------------------------------------------------------------------------------------------------------------------
const L = (kind, cat, name, src, glyph, tags, extra = {}) => ({ kind, cat, name, src, glyph, tags, ...extra })
export const LIBRARY = [
    ...['sphere', 'box', 'cylinder', 'capsule', 'torus', 'cone', 'plane', 'rectangle', 'disc'].map(n => L('object', 'Primitives', n, 'built-in', '◯', ['shape'])),
    L('object', 'Primitives', 'code (WGSL)', 'built-in', '{ }', ['shape', 'code']),
    L('object', 'Optics', 'lens (two radii)', 'built-in', '◖◗', ['refractive']),
    L('object', 'Optics', 'TIR collimator', 'built-in', '▽', ['refractive', 'planned']),
    L('object', 'Optics', 'parabolic reflector', 'built-in', '◡', ['reflective', 'planned']),
    L('object', 'Optics', 'Fresnel lens', 'built-in', '≋', ['refractive', 'planned']),
    L('object', 'Optics', 'light guide plate', 'built-in', '▭', ['refractive', 'planned']),
    ...['twist', 'bend', 'repeat', 'mirror', 'round', 'shell', 'displace'].map(n => L('object', 'Modifiers', n, 'built-in', '⟲', ['modifier'])),
    L('light', 'Lights', 'rectangle light', 'built-in', '▭', ['sheet']), L('light', 'Lights', 'disc light', 'built-in', '◯', ['sheet']),
    L('light', 'Lights', 'ray file (Zemax)', 'built-in', '✺', ['measured']),
    L('light', 'LEDs', 'mid-power 3030, 4000 K', 'built-in', '▪', ['led', 'planned']),
    L('light', 'LEDs', 'COB 19 mm, 3000 K', 'built-in', '●', ['led', 'planned']),
    L('light', 'LEDs', 'OSRAM ray set (ZEMAXRAYFILE.DAT)', 'mine', '✺', ['measured', 'ray file']),
    ...[['diffuse', '#c8c8c8'], ['plastic', '#b04030'], ['metal', '#b8b8c0'], ['mirror', '#e8eef2'], ['glass', '#9fd3e6'], ['glowing', '#fff2c4']]
        .map(([n, c]) => L('material', 'Presets', n, 'built-in', '', ['preset'], { swatch: c })),
    ...[['PMMA n 1.49', '#a8dcef'], ['polycarbonate n 1.585', '#9cd0e8'], ['silicone n 1.41', '#cdeef6'], ['N-BK7 n 1.517', '#b5e3f2']]
        .map(([n, c]) => L('material', 'Optical', n, 'built-in', '', ['glass', 'refractive'], { swatch: c })),
    ...[['white MCPCB (ρ 0.9)', '#f4f4f0'], ['anodised black (ρ 0.04)', '#1d1f22'], ['specular aluminium (Miro)', '#dfe6ea']]
        .map(([n, c]) => L('material', 'Surfaces', n, 'built-in', '', ['surface'], { swatch: c })),
    L('material', 'Measuring', 'optics detector', 'built-in', '', ['detector'], { swatch: '#2c6b54' }),
    L('material', 'Measuring', 'ray limiter', 'built-in', '', ['limiter'], { swatch: '#5a3f6b' }),
    L('material', 'Optical', 'satin PMMA (ours)', 'mine', '', ['glass', 'diffusing'], { swatch: '#d9eef5' }),
    L('object', 'Optics', 'TIR lens v3 (ours)', 'mine', '▽', ['refractive']),
    L('object', 'Optics', 'Lens (this scene)', 'project', '◖◗', ['refractive']),
]

//----------------------------------------------------------------------------------------------------------------------
// HELP: every registry entry carries its own. Tooltips, the Help panel and a future manual read these.
//----------------------------------------------------------------------------------------------------------------------
let helpShow = () => { }
const tip = (text) => ` data-tip="${text.replace(/"/g, '&quot;')}"`

//----------------------------------------------------------------------------------------------------------------------
// PANELS
//----------------------------------------------------------------------------------------------------------------------
const MOD = { renderer: 'r', optics: 'o', builder: 'b', app: 'a' }
export const PANELS = {}
const panel = (id, title, module, help, create) => { PANELS[id] = { id, title, module, help, create } }

/* THE VIEWPORT holds what belongs to A VIEW, and nothing else: its camera, what it shows, how that is
   exposed or scaled, what is drawn over it. The scene's light (sun, sky) is the scene's -- the
   Environment in the tree; the renderer's quality (sampling, size) is the Renderer panel's. Two
   viewports can show the same scene differently, which is why these are per view.
   WHAT IT SHOWS is one menu, not three buttons, and it says what each mode is: the "lux on surfaces"
   view re-traces with every visible surface white for one bounce (core/uniforms.schema.js
   measureMode), which is not the optics trace's detector map. The old buttons were both called
   "Illuminance". */
const SHOWS = {
    photo: { label: 'Photographic', tip: 'The picture, exposed and tone-mapped', scale: '◐ EV 9.2 · AgX', scaleTip: 'Exposure and tone curve for this view' },
    lux: { label: 'Lux on surfaces', tip: 'Every visible surface in false colour as the lux falling on it: traced again with the surfaces white for one bounce. For the light on one detector, use the Detector map.', scale: '1 – 100 000 lx · 10 bands', scaleTip: 'The false-colour range (log) and bands for this view' },
    lum: { label: 'Luminance', tip: 'The picture as it is, in false colour in cd/m²: glare and dark corners as numbers', scale: '1 – 100 000 cd/m² · smooth', scaleTip: 'The false-colour range (log) and bands for this view' },
}
panel('viewport', 'Viewport', 'renderer', 'A view of the scene. Its toolbar holds only what belongs to this view: the camera, what it shows, its exposure or false-colour scale, and what is drawn over it. Open a second viewport to see the scene another way at the same time.', el => {
    el.innerHTML = `<div class="view" style="position:absolute;inset:0">
        <canvas class="pic" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
        <div class="vt float">
            <button${tip('Camera: orbit or fly, perspective or orthographic, field of view, and the saved viewpoints')}>⌖ Perspective ▾</button>
            <span class="vline"></span>
            <div class="m" style="position:relative"><button class="shows"${tip('What this view shows')}></button><div class="dropdown" hidden>
                ${Object.entries(SHOWS).map(([k, v]) => `<div data-show="${k}"${tip(v.tip)}>${v.label}</div>`).join('')}
                <hr><div class="note" style="white-space:normal;max-width:280px">Lux on surfaces is the renderer's estimate everywhere in the picture. The light on one detector, with its error bar, is the optics trace's Detector map.</div></div></div>
            <button class="scale"></button>
            <span class="vline"></span>
            <button class="on"${tip('The traced rays drawn over the view (the optics module draws them)')}>✺ rays</button><button class="on"${tip('Handles on the selection: move, rotate, scale')}>✥ handles</button><button${tip('Measure: pin a reading, or average a rectangle, in this view\'s unit')}>⌖ measure</button>
            <span class="vline"></span>
            <button${tip('Split this view, pop it out, save an image of it')}>⋯</button>
        </div>
        <div class="hud float">412 spp · 18.4 ms/sample · 1188×969</div></div>`
    const cv = $('.pic', el), bShows = $('.shows', el), bScale = $('.scale', el)
    let mode = 'photo'
    const draw = () => { drawPicture(cv, { rays: '1', mode: mode === 'photo' ? 'picture' : 'lux' }); bShows.textContent = `Shows: ${SHOWS[mode].label} ▾`; bScale.textContent = SHOWS[mode].scale; bScale.dataset.tip = SHOWS[mode].scaleTip }
    bShows.onclick = e => { e.stopPropagation(); const d = bShows.nextElementSibling; d.hidden = !d.hidden }
    el.querySelectorAll('[data-show]').forEach(d => d.onclick = () => { mode = d.dataset.show; d.parentElement.hidden = true; draw() })
    new ResizeObserver(draw).observe(el)
})
panel('scene', 'Scene', 'builder', 'The scenes of the project, their objects, lights and materials. Drag to reorder or into another scene; drop library items here.', el => {
    el.innerHTML = `<div class="scroll" style="height:100%"><div class="h">Project <span class="spacer"></span><button${tip('Undo (Ctrl Z)')}>↶</button><button${tip('Redo (Ctrl Y)')}>↷</button><button${tip('Add from the library (Shift A)')} data-cmd="library">＋</button></div>
        <div class="tree"><div>▸ ◧ menger</div><div>▸ ◧ showcase</div><div>▾ ◧ optics-test <span class="kind">mm</span></div>
        <div class="i1" data-sel="env"${tip('The sun, the sky or a studio light: part of the scene, saved with it')}>☼ Environment <span class="kind">sun & sky</span></div>
        <div class="i1" data-sel="led">☀ LED die <span class="tag src">light</span></div><div class="i1 sel" data-sel="lens">◖◗ Lens <span class="kind">PMMA</span></div>
        <div class="i1" data-sel="screen">▭ Screen <span class="tag det">detector</span></div><div class="i1">▸ ▦ Housing</div><div class="i1">▭ Cut plane <span class="tag lim">limiter</span></div>
        <div class="i1">▾ Materials</div><div class="i2">PMMA n 1.49</div><div class="i2">Screen <span class="tag det">detector</span></div></div></div>`
    el.querySelectorAll('[data-sel]').forEach(r => r.onclick = () => {
        el.querySelectorAll('.tree .sel').forEach(x => x.classList.remove('sel')); r.classList.add('sel')
        window.dispatchEvent(new CustomEvent('select', { detail: r.dataset.sel }))
    })
})
panel('properties', 'Properties', 'builder', 'The selected thing\'s settings. Every value has a path: hover its name to see it, ◇ sends it to Parameters (for the optimiser), ⧫ puts a key on the timeline.', el => {
    const row = (label, ctl, path) => `<div class="prop"><label${path ? tip(`${path}  ·  click to copy the path`) : ''}>${label}</label><div class="ctl">${ctl}${path ? `<span class="pk"${tip('Send to Parameters')}>◇</span><span class="kf"${tip('Key this value on the timeline')}>⧫</span>` : ''}</div></div>`
    const num = (v, path, label) => row(label, `<input type="range"><input class="num" value="${v}">`, path)
    const VIEWS = {
        lens: () => `<div class="h">◖◗ Lens <span class="spacer"></span><span class="tag">object</span></div>
            ${row('material', '<select><option>PMMA n 1.49</option></select>')}
            ${[...PARAMS.values()].filter(p => p.id.startsWith('scene/Lens/')).map(p =>
                `<div class="prop"><label${tip(`${p.id}  ·  click to copy the path`)}>${p.label}</label><div class="ctl"><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.value}"><input class="num" value="${p.value}">
                 <span class="pk${p.tune ? ' on' : ''}"${tip(p.tune ? 'In Parameters: the optimiser may change it' : 'Send to Parameters')}>${p.tune ? '◆' : '◇'}</span><span class="kf"${tip('Key this value on the timeline')}>⧫</span></div></div>`).join('')}
            <div class="h">code</div><div class="pad"><button>Edit in a tab…</button> <span class="note">compiles clean</span></div>`,
        env: () => `<div class="h">☼ Environment <span class="spacer"></span><span class="tag">scene</span></div>
            ${row('kind', '<select><option>sun & sky</option><option>studio (uniform)</option><option>none (dark)</option></select>')}
            ${num('100 000', 'scene/Environment/sun lx', 'sun, lx (direct normal)')}${num('20 000', 'scene/Environment/sky lx', 'sky, lx (horizontal)')}
            ${num('45', 'scene/Environment/sun elevation', 'sun elevation °')}${num('30', 'scene/Environment/sun azimuth', 'sun azimuth °')}
            ${num('0.53', 'scene/Environment/sun diameter', 'sun diameter °')}${num('3', 'scene/Environment/turbidity', 'turbidity')}
            <div class="pad note">This was the renderer's Light page. It describes the scene, not the renderer or a view, so it is saved with the scene -- a room scene keeps its sun.</div>`,
        led: () => `<div class="h">☀ LED die <span class="spacer"></span><span class="tag src">light</span></div>
            ${row('shape', '<select><option>rectangle 2 × 1 mm</option></select>')}${num('100', 'scene/LED die/flux', 'flux, lm')}${num('4000', 'scene/LED die/CCT', 'CCT, K')}
            ${row('distribution', '<select><option>cos^n (Lambertian)</option></select>')}${num('1', 'scene/LED die/n', 'n')}${num('1.49', 'scene/LED die/emits into n', 'emits into n')}
            ${row('faces · transparent', '<input type="checkbox"> both <input type="checkbox" checked> transparent')}`,
        screen: () => `<div class="h">▭ Screen <span class="spacer"></span><span class="tag det">detector</span></div>
            ${row('material', '<select><option>Screen (optics detector)</option></select>')}${num('40', 'scene/Screen/position/z', 'distance z, mm')}${num('60', 'scene/Screen/width', 'width, mm')}
            <div class="pad"><button data-cmd="illuminance">Show its detector map</button></div>`,
    }
    const show = k => { el.innerHTML = `<div class="scroll" style="height:100%">${(VIEWS[k] ?? VIEWS.lens)()}</div>` }
    show('lens')
    window.addEventListener('select', e => show(e.detail))
})
panel('library', 'Library', 'app', 'Objects, lights and materials: built in, your own, and this project\'s. Search, filter, then drag into the view or the scene tree. "Save to library" keeps a selected object or material for other projects.', el => {
    el.innerHTML = `<div class="col" style="height:100%">
        <div class="bar"><input id="libq" placeholder="Search the library…" style="flex:1"><button class="on" data-kind="object">Objects</button><button data-kind="light">Lights</button><button data-kind="material">Materials</button></div>
        <div class="bar" style="background:var(--panel)"><span class="note">from</span><button class="on" data-src="all">all</button><button data-src="built-in">built in</button><button data-src="mine">mine</button><button data-src="project">this project</button><span class="spacer"></span><button${tip('Save the selected object or material to your library')}>＋ Save to library</button><button${tip('Import or export a library file')}>⇅</button></div>
        <div class="scroll grow libgrid"></div>
        <div class="pad note" style="border-top:1px solid var(--line)">Drag onto the view or the tree · double-click inserts at the selection · the Add menu keeps the 10 most used</div></div>`
    const S = { kind: 'object', src: 'all', q: '' }
    const draw = () => {
        const list = LIBRARY.filter(x => x.kind === S.kind && (S.src === 'all' || x.src === S.src)
            && (!S.q || (x.name + ' ' + x.tags.join(' ') + ' ' + x.cat).toLowerCase().includes(S.q)))
        const cats = [...new Set(list.map(x => x.cat))]
        $('.libgrid', el).innerHTML = cats.map(c => `<div class="h">${c}</div><div class="cards">${list.filter(x => x.cat === c).map(x =>
            `<div class="card" draggable="true"${tip(`${x.name} · ${x.src}${x.tags.includes('planned') ? ' · planned' : ''} · tags: ${x.tags.join(', ')}`)}>
               <div class="thumb" style="${x.swatch ? `background:radial-gradient(circle at 35% 30%, #fff8 0 8%, ${x.swatch} 40%, #0006 100%)` : ''}">${x.swatch ? '' : x.glyph}</div>
               <div class="nm">${x.name}</div>${x.src !== 'built-in' ? `<span class="tag">${x.src}</span>` : ''}${x.tags.includes('planned') ? '<span class="tag">planned</span>' : ''}</div>`).join('')}</div>`).join('')
            || '<div class="pad note">Nothing matches.</div>'
    }
    el.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { S.kind = b.dataset.kind; el.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('on', x === b)); draw() })
    el.querySelectorAll('[data-src]').forEach(b => b.onclick = () => { S.src = b.dataset.src; el.querySelectorAll('[data-src]').forEach(x => x.classList.toggle('on', x === b)); draw() })
    $('#libq', el).oninput = e => { S.q = e.target.value.toLowerCase(); draw() }
    draw()
})
panel('render', 'Renderer', 'renderer', 'How hard the renderer works: tracing, sampling, render size, and its diagnostics. The camera, what a view shows and its exposure are the view\'s (its toolbar); the sun and sky are the scene\'s (Environment).', el => {
    const sec = (t, rows) => `<div class="h">${t}</div>${rows.map(([l, c]) => `<div class="prop"><label>${l}</label><div class="ctl">${c}</div></div>`).join('')}`
    el.innerHTML = `<div class="scroll" style="height:100%">
        ${sec('∷ Tracing', [['max bounces', '<input type="range"><span class="num">12</span>'], ['next-event estimation', '<input type="checkbox" checked>'], ['light tracing (caustics)', '<input type="checkbox" checked>'], ['photons per pixel', '<input type="range"><span class="num">1.0</span>'], ['learn photon map', '<input type="checkbox" checked>'], ['Russian roulette', '<input type="checkbox" checked>'], ['firefly clamp × white', '<input type="range"><span class="num">0</span>'], ['max averages · keep on move', '<input class="num" value="0"><input class="num" value="4">']])}
        ${sec('▭ Render size', [['size', '<select><option>fit the view</option><option>fixed</option></select>'], ['resolution', '<select><option>100 %</option><option>50 %</option></select>'], ['pixels', '<span class="num">1188 × 969</span>']])}
        ${sec('⚙ Advanced', [['surface tolerance', '<select><option>auto</option></select>'], ['fast normals', '<input type="checkbox" checked>'], ['NEE sun/sky split', '<input type="range">'], ['TRACE2 (experimental)', '<input type="checkbox">']])}
        <div class="pad note">Saving an image is File → Save picture, a dialog with its own size and samples.</div></div>`
})
panel('tests', 'Tests', 'renderer', 'The renderer\'s measurement bench: one row per test, known answers, a report to copy.', el => {
    el.innerHTML = `<div class="scroll pad" style="height:100%"><table class="t"><tr><th>test</th><th>last result</th><th></th></tr>
        ${['photometry', 'error-bar', 'illuminance', 'optics-balance', 'optics-refraction', 'optics-colour', 'optics-farfield', 'furnace', 'bsdf-parity'].map(t => `<tr><td>${t}</td><td class="note">–</td><td><button>Run</button></td></tr>`).join('')}</table></div>`
})
panel('optics', 'Optics setup', 'optics', 'What the trace starts from, where light is counted, and what feeds the far field. Only what changes the traced data is here; how a chart shows it is on the chart.', el => {
    el.innerHTML = `<div class="scroll" style="height:100%">
        <div class="h">Sources</div><div class="pad" style="font-size:12px">☀ <b>LED die</b> · 100 lm · 4000 K · Lambertian · into n 1.49</div>
        <div class="h">Where light is counted</div><div class="tree"><div>▭ Screen <span class="tag det">detector</span></div><div>▭ Cut plane <span class="tag lim">limiter</span></div><div>✺ Far field <span class="kind">every escaping ray</span></div></div>
        <div class="h">Look</div>
        <div class="prop"><label>rays · steps</label><div class="ctl"><input class="num" value="2000"><input class="num" value="6"><button class="on">Live</button></div></div>
        <div class="h">Measure</div>
        <div class="prop"><label>rays (millions)</label><div class="ctl"><input class="num" value="2"><button class="primary">▶ Run analysis</button></div></div>
        <div class="prop"><label>far field from</label><div class="ctl"><select><option>every escaping ray</option><option>rays at: Screen</option></select></div></div>
        <div class="prop"><label>axis</label><div class="ctl"><select><option>LED die</option></select></div></div>
        <div class="prop"><label>γ step · C step</label><div class="ctl"><select><option>1°</option></select><select><option>5°</option></select></div></div>
        <div class="h">Limits <span class="spacer"></span><span class="note" style="text-transform:none;letter-spacing:0">folded by default</span></div></div>`
})
panel('results', 'Results', 'optics', 'Where the flux went: emitted, escaped, absorbed, detected, lost, each ± its error; per object and per material.', el => {
    el.innerHTML = `<div class="scroll pad" style="height:100%"><table class="t" style="width:auto"><tr><th></th><th>lm</th></tr><tr><td>emitted</td><td>100.00</td></tr><tr><td>escaped</td><td>11.24 ± 0.06</td></tr>
        <tr><td>absorbed</td><td>2.78 ± 0.03</td></tr><tr><td>on detectors</td><td>85.98 ± 0.07</td></tr><tr><td>lost</td><td>0.00</td></tr></table></div>`
})

/* A CHART PANEL: its strip carries its own controls -- the quantity first, then what that quantity needs */
const quantitySelect = kind => `<select class="qsel"${tip('What the chart shows. Colour quantities need the colour tallies of the trace.')}>${QUANTITIES.filter(q => q.of.includes(kind)).map(q => `<option value="${q.id}">${q.label}${q.unit ? ` (${q.unit})` : ''}</option>`).join('')}</select>`
panel('intensity', 'Intensity', 'optics', 'The far field: intensity (or colour) against angle, in C planes. The strip picks what is shown, the planes, the scale and the range; ⇩ exports the chart or its data.', el => {
    el.innerHTML = `<div class="col" style="height:100%"><div class="ct bar">${quantitySelect('intensity')}<button${tip('Which C planes')}>C 0, 90 ▾</button><button${tip('Linear or logarithmic')}>lin</button><button${tip('Angle range: auto zooms to the light')}>±auto</button><button${tip('Draw a pinned run dashed underneath')}>ref</button><button${tip('PNG, CSV, IES')}>⇩</button><span class="spacer"></span><span class="note">I max 2 410 cd · beam 27.9° / 36.1°</span></div>
        <div class="row grow" style="gap:6px;padding:6px"><div class="chartbox" data-q="polar"></div><div class="chartbox" data-q="cart"></div></div></div>`
    const boxes = [...el.querySelectorAll('.chartbox')].map(b => { const c = document.createElement('canvas'); Object.assign(c.style, { width: '100%', height: '100%', display: 'block' }); b.appendChild(c); return c })
    const sel = $('.qsel', el)
    const draw = () => {
        const q = QUANTITIES.find(x => x.id === sel.value)
        if (q.id === 'I' || q.id === 'Iklm') {
            const k = q.id === 'Iklm' ? 1000 / 100 : 1
            const curves = CURVES.map(c => ({ ...c, points: c.points.map(p => ({ ...p, I: p.I * k, se: p.se * k })) }))
            const levels = [{ at: 0.5 * STATS.max.I * k, label: '50 %' }, { at: 0.1 * STATS.max.I * k, label: '10 %' }]
            drawPolar(boxes[0], { curves, levels, unit: q.unit }); drawCartesian(boxes[1], { curves, levels, unit: q.unit })
        } else {
            // colour against angle: a line chart whose axis starts where the values do, not at 0
            drawLine(boxes[0], { series: [0, 90].map(C => ({ label: `C${C}`, points: Array.from({ length: 121 }, (_, i) => { const a = i - 60; return { x: a, y: colourAt(q.id, Math.min(1, Math.abs(a) / (C ? 40 : 32))) } }) })),
                                 xLabel: 'γ, °', unit: q.unit || q.label, title: `${q.label} against angle` })
            drawLine(boxes[1], { series: [{ label: 'flux-weighted over C', points: Array.from({ length: 61 }, (_, i) => ({ x: i, y: colourAt(q.id, Math.min(1, i / 36)) })) }],
                                 xLabel: 'γ, °', unit: q.unit || q.label, title: 'averaged over C' })
        }
    }
    sel.onchange = draw
    new ResizeObserver(draw).observe(el)
})
panel('illuminance', 'Detector map · Screen', 'optics', 'A detector\'s map with isolux lines, and profiles through a point; or the far field projected onto a plane. The strip picks the quantity -- illuminance, or the colour of the light that arrived.', el => {
    el.innerHTML = `<div class="col" style="height:100%"><div class="ct bar">${quantitySelect('illuminance')}<button${tip('Which detector, or the far field on a plane h away')}>Screen ▾</button><button class="on"${tip('Isolux (or iso-CCT) lines')}>lines</button><button${tip('Cells and smoothing of the map')}>72 · gauss</button><button${tip('Draw a pinned run dashed underneath')}>ref</button><button${tip('PNG, CSV')}>⇩</button><span class="spacer"></span><span class="note">U0 0.78 · E mean 301 lx</span></div>
        <div class="row grow" style="gap:6px;padding:6px"><div class="chartbox" style="flex-grow:1.3"></div><div class="chartbox" data-chart="profile"></div></div></div>`
    const box = el.querySelector('.chartbox'), c = document.createElement('canvas')
    Object.assign(c.style, { width: '100%', height: '100%', display: 'block' }); box.appendChild(c)
    const sel = $('.qsel', el)
    const draw = () => {
        const q = QUANTITIES.find(x => x.id === sel.value)
        if (q.id === 'E') drawHeatmap(c, MAP, { contours: isolux(MAP, [100, 200, 300, 400].filter(v => v < MAP.max)), point: PT, lengthUnit: 'mm' })
        else drawField(c, { f: (a, b) => colourAt(q.id, Math.min(1, Math.hypot((a - 3) / 1.25, b) / 22)), label: q.label, unit: q.unit })
    }
    sel.onchange = draw
    new ResizeObserver(draw).observe(box)
})
panel('parameters', 'Parameters', 'app', 'Every value you may want to tune, animate or script, by its path. ◆ = the optimiser may change it; ⧫ = keyed on the timeline. The same paths work in the command palette and a script.', el => {
    el.innerHTML = `<div class="scroll" style="height:100%"><table class="t"><tr><th>path</th><th>value</th><th>range</th><th${tip('The optimiser may change it')}>◆</th><th${tip('On the timeline')}>⧫</th></tr>
        ${[...PARAMS.values()].map(p => `<tr><td${tip('Click to copy')}>${p.id}</td><td>${p.value} ${p.unit ?? ''}</td><td class="note">${p.options ? Object.keys(p.options).join(' / ') : `${p.min} … ${p.max}`}</td><td>${p.tune ? '◆' : '<span class="note">◇</span>'}</td><td><span class="note">⧫</span></td></tr>`).join('')}</table>
        <pre class="pad note" style="margin:0;font:11px var(--mono)">app.params.get('scene/Lens/back radius')        // -15.5
app.params.set('scene/Lens/back radius', -16)    // what an optimiser or a key does</pre></div>`
})
panel('runs', 'Runs', 'app', 'Every analysis, with the parameters it ran with and its numbers. Pin one as the reference to draw it dashed under every chart; restore puts its parameters back.', el => {
    el.innerHTML = `<div class="scroll" style="height:100%"><table class="t"><tr><th>#</th><th>back radius</th><th>front radius</th><th>U0 · Screen</th><th>E mean</th><th>efficiency</th><th>beam C0</th><th></th></tr>
        <tr class="ref"><td>12</td><td>-14.0</td><td>8.0</td><td>0.71 ± .01</td><td>312</td><td>.861</td><td>29.4°</td><td class="note">reference</td></tr>
        <tr><td>13</td><td>-15.0</td><td>8.0</td><td>0.75 ± .01</td><td>305</td><td>.859</td><td>28.7°</td><td></td></tr>
        <tr class="sel"><td>14</td><td>-15.5</td><td>8.0</td><td>0.78 ± .01</td><td>301</td><td>.860</td><td>27.9°</td><td class="note">current</td></tr></table></div>`
})
panel('timeline', 'Timeline', 'app', 'lib/timeline, docked: keys on any parameter by its path, played or exported to video. Placeholder here.', el => {
    el.innerHTML = `<div class="col" style="height:100%"><div class="bar"><button>⏮</button><button>▶</button><button>⏭</button><span class="num" style="padding:0 8px">00:02.40 / 00:08.00</span><span class="spacer"></span><button>Export video…</button></div>
        <div class="grow tl">${['scene/Lens/back radius', 'scene/LED die/CCT', 'render/view/exposure'].map((p, k) => `<div class="trk"><span class="lb">${p}</span><span class="ln">${[0.1, 0.35, 0.7, 0.9].slice(0, 2 + k).map(x => `<i style="left:${x * 100}%">◆</i>`).join('')}</span></div>`).join('')}
        <div class="play" style="left:calc(190px + (100% - 190px) * 0.3)"></div></div></div>`
})
panel('help', 'Help', 'app', 'Help for whatever is under the pointer, from the same text as the tooltips. F1 opens it.', el => {
    el.innerHTML = `<div class="scroll pad" style="height:100%;font-size:12.5px;line-height:1.5"><div class="helpbody"><b>Help</b><p class="note">Point at anything: its help shows here. F1 opens this panel; Help → Take the tour walks through the main parts.</p></div></div>`
    helpShow = (title, text) => { const b = $('.helpbody', el); if (b) b.innerHTML = `<b>${title}</b><p>${text}</p>` }
})

//----------------------------------------------------------------------------------------------------------------------
// TWO SMALL CHARTS the real ones will need an option for: an axis that starts where the values do
//----------------------------------------------------------------------------------------------------------------------
function fit(c) {
    const dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight
    c.width = W * dpr; c.height = H * dpr
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#16191c'; g.fillRect(0, 0, W, H)
    g.font = '11px ui-sans-serif, system-ui, sans-serif'
    return { g, W, H }
}
function drawLine(c, { series, xLabel, unit, title }) {
    const { g, W, H } = fit(c)
    const pts = series.flatMap(s => s.points), xs = pts.map(p => p.x), ys = pts.map(p => p.y)
    const x0 = Math.min(...xs), x1 = Math.max(...xs), pad = (Math.max(...ys) - Math.min(...ys)) * 0.1 || 1
    const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad
    const L = 60, T = 34, Rr = W - 14, B = H - 30
    const X = x => L + (x - x0) / (x1 - x0) * (Rr - L), Y = y => B - (y - y0) / (y1 - y0) * (B - T)
    g.fillStyle = '#dde3e8'; g.fillText(title, 8, 15)
    g.strokeStyle = 'rgba(160,175,190,0.16)'; g.fillStyle = '#8fa3b3'; g.textAlign = 'right'; g.textBaseline = 'middle'
    for (let k = 0; k <= 4; k++) { const v = y0 + (y1 - y0) * k / 4, y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(Rr, y); g.stroke(); g.fillText(Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(4), L - 5, y) }
    g.fillText(unit, L - 5, T - 12); g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText(xLabel, Rr, B + 16)
    g.textAlign = 'center'; for (let k = 0; k <= 4; k++) { const v = x0 + (x1 - x0) * k / 4; g.fillText(v.toFixed(0), X(v), B + 4) }
    series.forEach((s, k) => {
        g.strokeStyle = ['#3987e5', '#d95926', '#199e70'][k % 3]; g.lineWidth = 2; g.beginPath()
        s.points.forEach((p, i) => i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))); g.stroke()
        g.fillStyle = '#dde3e8'; g.textAlign = 'right'; g.fillText(s.label, Rr - 30, 8 + k * 15); g.fillRect(Rr - 24, 14 + k * 15, 20, 2)
    })
}
function drawField(c, { f, label, unit }) {
    const { g, W, H } = fit(c)
    const n = 72, size = Math.min(W - 110, H - 50), x0 = 50, y0 = 30, vals = []
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vals.push(f(-30 + 60 * (i + 0.5) / n, 30 - 60 * (j + 0.5) / n))
    const lo = Math.min(...vals), hi = Math.max(...vals)
    // a two-hue ramp for a colour quantity: cool (bluer, higher CCT) to warm; not the false colour of a flux
    const ramp = t => [Math.round(60 + 190 * t), Math.round(120 + 60 * Math.sin(Math.PI * t)), Math.round(230 - 180 * t)]
    const cell = size / n
    vals.forEach((v, k) => { const t = hi > lo ? (v - lo) / (hi - lo) : 0; g.fillStyle = `rgb(${ramp(label === 'CCT' ? 1 - t : t).join(',')})`; g.fillRect(x0 + (k % n) * cell, y0 + Math.floor(k / n) * cell, cell + 0.5, cell + 0.5) })
    g.fillStyle = '#dde3e8'; g.textAlign = 'left'; g.fillText(`${label} on Screen`, 8, 15)
    const bx = x0 + size + 14
    for (let k = 0; k < 100; k++) { g.fillStyle = `rgb(${ramp(label === 'CCT' ? 1 - k / 99 : k / 99).join(',')})`; g.fillRect(bx, y0 + size - (k + 1) * size / 100, 12, size / 100 + 0.5) }
    g.fillStyle = '#8fa3b3'; g.fillText(`${hi >= 100 ? hi.toFixed(0) : hi.toFixed(4)} ${unit}`, bx + 16, y0 + 6); g.fillText(`${lo >= 100 ? lo.toFixed(0) : lo.toFixed(4)}`, bx + 16, y0 + size - 4)
}

//----------------------------------------------------------------------------------------------------------------------
// PRESETS -- layouts, built from the panel registry. Custom ones are dockview's own toJSON, kept.
//----------------------------------------------------------------------------------------------------------------------
export const PRESETS = {
    Design: { help: 'Build the scene: the view, the tree, the properties, the library.', build: api => {
        add(api, 'viewport')
        add(api, 'scene', { referencePanel: 'viewport', direction: 'left' }, { width: 260 })
        add(api, 'library', { referencePanel: 'scene', direction: 'below' }, { height: 380 })
        add(api, 'properties', { referencePanel: 'viewport', direction: 'right' }, { width: 320 })
        add(api, 'help', { referencePanel: 'properties', direction: 'within' }, null, true)
    } },
    Analyse: { help: 'Measure and decide: the setup, the map, the far field, the runs -- and the view, smaller.', build: api => {
        add(api, 'illuminance')
        add(api, 'intensity', { referencePanel: 'illuminance', direction: 'below' })
        add(api, 'optics', { referencePanel: 'illuminance', direction: 'left' }, { width: 300 })
        add(api, 'viewport', { referencePanel: 'optics', direction: 'below' }, { height: 300 })
        add(api, 'runs', { referencePanel: 'intensity', direction: 'below' }, { height: 170 })
        add(api, 'parameters', { referencePanel: 'runs', direction: 'within' }, null, true)
        add(api, 'results', { referencePanel: 'runs', direction: 'within' }, null, true)
        add(api, 'properties', { referencePanel: 'illuminance', direction: 'right' }, { width: 290 })
    } },
    Render: { help: 'Make a picture: the view large, the renderer\'s settings beside it.', build: api => {
        add(api, 'viewport')
        add(api, 'render', { referencePanel: 'viewport', direction: 'right' }, { width: 320 })
        add(api, 'tests', { referencePanel: 'render', direction: 'within' }, null, true)
    } },
    Animate: { help: 'Keys over time: the view, the properties, the timeline under them.', build: api => {
        add(api, 'viewport')
        add(api, 'properties', { referencePanel: 'viewport', direction: 'right' }, { width: 300 })
        add(api, 'timeline', { referencePanel: 'viewport', direction: 'below' }, { height: 200 })
    } },
}
function add(api, id, position, size, inactive) {
    const p = PANELS[id]
    const panelApi = api.addPanel({ id, component: id, title: p.title, ...(position ? { position } : {}), ...(inactive ? { inactive: true } : {}) })
    if (size) panelApi.group.api.setSize(size)
    return panelApi
}

//----------------------------------------------------------------------------------------------------------------------
// COMMANDS -- every action once; the menus and the palette are made from this
//----------------------------------------------------------------------------------------------------------------------
export const COMMANDS = []
const cmd = (menu, label, run, keys = '', help = '') => COMMANDS.push({ menu, label, run, keys, help })

//----------------------------------------------------------------------------------------------------------------------
// BOOT
//----------------------------------------------------------------------------------------------------------------------
export function boot() {
    const host = $('#dock')
    const popoutUrl = new URL('popout.html', location.href).pathname
    const api = createDockview(host, {
        theme: themeDark,
        popoutUrl,
        createComponent: ({ name }) => {
            const el = document.createElement('div')
            Object.assign(el.style, { height: '100%', position: 'relative', overflow: 'hidden' })
            el.dataset.panel = name
            return { element: el, init: () => { PANELS[name].create(el); requestAnimationFrame(() => mountAll(el)) } }
        },
        // every group's header: its module, then float, pop out (another monitor), maximise
        createRightHeaderActionComponent: group => {
            const el = h(`<div class="gact"><button title="Float">⧉</button><button title="Pop out to its own window (another monitor)">⇱</button><button title="Maximise (double-click a tab)">⤢</button></div>`)
            return {
                element: el,
                init: ({ containerApi }) => {
                    const [f, p, m] = el.querySelectorAll('button')
                    f.onclick = () => containerApi.addFloatingGroup(group, { width: 520, height: 380 })
                    p.onclick = () => containerApi.addPopoutGroup(group, { popoutUrl })
                    m.onclick = () => (group.api.isMaximized() ? group.api.exitMaximized() : group.api.maximize())
                },
                dispose: () => { },
            }
        },
    })
    window.DOCK = api

    // the module a tab belongs to, as a coloured mark on the tab
    const markTabs = () => requestAnimationFrame(() => {
        for (const t of document.querySelectorAll('.dv-tab')) {
            if (t.querySelector('.mod')) continue
            const p = Object.values(PANELS).find(x => x.title === t.textContent.trim())
            if (p) (t.querySelector('.dv-default-tab-content') ?? t).prepend(h(`<span class="mod ${MOD[p.module]}" title="${p.module}">${p.module === 'renderer' ? 'render' : p.module === 'app' ? 'app' : p.module}</span>`))
        }
    })
    api.onDidLayoutChange(markTabs)

    let current = 'Design'
    const apply = name => {
        api.clear()
        if (PRESETS[name]) PRESETS[name].build(api)
        else { try { api.fromJSON(JSON.parse(localStorage.getItem('mock.layout.' + name))) } catch { PRESETS.Design.build(api) } }
        current = name
        for (const b of document.querySelectorAll('.presets button[data-preset]')) b.classList.toggle('on', b.dataset.preset === name)
        markTabs()
    }
    const customs = () => { try { return JSON.parse(localStorage.getItem('mock.layouts') || '[]') } catch { return [] } }
    const drawPresets = () => {
        $('.presets').innerHTML = Object.keys(PRESETS).map(n => `<button data-preset="${n}"${tip(PRESETS[n].help)}>${n}</button>`).join('')
            + customs().map(n => `<button data-preset="${n}"${tip('Your saved layout')}>${n}</button>`).join('')
            + `<button data-save${tip('Save the current arrangement as a layout of your own')}>＋</button>`
        $('.presets').querySelectorAll('[data-preset]').forEach(b => b.onclick = () => apply(b.dataset.preset))
        $('.presets [data-save]').onclick = () => {
            const name = `Custom ${customs().length + 1}`
            try { localStorage.setItem('mock.layout.' + name, JSON.stringify(api.toJSON())); localStorage.setItem('mock.layouts', JSON.stringify([...customs(), name])) } catch { }
            drawPresets(); apply(name)
        }
    }
    drawPresets()
    apply('Design')

    // the commands, then the menus made from them
    const open = id => { const p = api.getPanel(id); if (p) p.api.setActive(); else add(api, id, { direction: 'right' }, { width: 360 }); markTabs() }
    const active = () => api.activePanel
    cmd('File', 'New scene', () => { }, 'Ctrl N'); cmd('File', 'Open scene, project or workspace…', () => { }, 'Ctrl O'); cmd('File', 'Save all scenes', () => { }, 'Ctrl S')
    cmd('File', 'Save current scene', () => { }); cmd('File', 'Save workspace (layout, render settings, camera)', () => { }); cmd('File', 'Choose ray file (.DAT)…', () => { })
    cmd('File', 'Save picture (PNG)…', () => open('render')); cmd('File', 'Export IES / LDT… (planned)', () => { }); cmd('File', 'Export 3D print (3MF / STL)…', () => { })
    cmd('Edit', 'Undo', () => { }, 'Ctrl Z'); cmd('Edit', 'Redo', () => { }, 'Ctrl Y'); cmd('Edit', 'Copy · Paste · Duplicate', () => { }, 'Ctrl C · V · D'); cmd('Edit', 'Delete', () => { }, 'Del')
    cmd('Edit', 'Move · Rotate · Scale', () => { }, 'G · R · S')
    cmd('Add', 'From the library…', () => open('library'), 'Shift A', 'Search every object, light and material')
    cmd('Add', 'Recently used: lens (two radii) · disc light · PMMA', () => { })
    for (const p of Object.values(PANELS)) cmd('View', p.title, () => open(p.id), '', p.help)
    for (const n of Object.keys(PRESETS)) cmd('Layout', `Layout: ${n}`, () => apply(n), '', PRESETS[n].help)
    cmd('Layout', 'Save layout as…', () => $('.presets [data-save]').click()); cmd('Layout', 'Reset this layout', () => apply(current))
    cmd('Window', 'Float the active panel', () => active() && api.addFloatingGroup(active().group, { width: 520, height: 380 }))
    cmd('Window', 'Pop out the active panel (another monitor)', () => active() && api.addPopoutGroup(active().group, { popoutUrl }))
    cmd('Window', 'Maximise the active panel', () => active()?.group.api.maximize(), 'Ctrl M')
    cmd('View', 'New viewport', () => { }); cmd('Render', 'Renderer settings', () => open('render')); cmd('Render', 'Measurement bench (Tests)', () => open('tests'))
    cmd('Optics', 'Trace (look)', () => { }, 'T'); cmd('Optics', 'Run analysis', () => { }, 'F5'); cmd('Optics', 'Optics setup', () => open('optics'))
    cmd('Optics', 'Intensity chart', () => open('intensity')); cmd('Optics', 'Detector map', () => open('illuminance')); cmd('Optics', 'Results', () => open('results'))
    cmd('Study', 'Parameters', () => open('parameters')); cmd('Study', 'Runs', () => open('runs')); cmd('Study', 'Pin the current run as reference', () => { })
    cmd('Study', 'Sweep a parameter… (later)', () => { }); cmd('Study', 'Optimise… (later)', () => { })
    cmd('Help', 'Help panel', () => open('help'), 'F1'); cmd('Help', 'Take the tour', () => tour(0)); cmd('Help', 'Keyboard shortcuts', () => palette('Ctrl'))
    cmd('Help', 'Documentation', () => { }); cmd('Help', 'About', () => { })
    for (const p of PARAMS.values()) cmd('Parameter', `${p.id} = ${p.value} ${p.unit ?? ''}`, () => open('parameters'), '', 'Set or key this value')

    const menubar = $('.menubar .menus')
    const MENUS = ['File', 'Edit', 'Add', 'View', 'Render', 'Optics', 'Study', 'Window', 'Help']
    menubar.innerHTML = MENUS.map(m => `<div class="m"><button data-menu>${m}</button><div class="dropdown" hidden>${
        COMMANDS.filter(c => c.menu === m || (m === 'View' && c.menu === 'Layout')).map((c, i, a) =>
            `${m === 'View' && c.menu === 'Layout' && a[i - 1]?.menu !== 'Layout' ? '<hr><div class="sub">layouts</div>' : ''}<div data-i="${COMMANDS.indexOf(c)}"${c.help ? tip(c.help) : ''}>${c.label}${c.keys ? `<kbd>${c.keys}</kbd>` : ''}</div>`).join('')}</div></div>`).join('')
    menubar.querySelectorAll('[data-menu]').forEach(b => b.onclick = e => {
        e.stopPropagation(); const d = b.nextElementSibling, was = !d.hidden
        document.querySelectorAll('.dropdown').forEach(x => x.hidden = true); d.hidden = was
    })
    menubar.querySelectorAll('.dropdown [data-i]').forEach(d => d.onclick = () => { COMMANDS[d.dataset.i].run(); document.querySelectorAll('.dropdown').forEach(x => x.hidden = true) })
    document.addEventListener('click', () => document.querySelectorAll('.dropdown').forEach(x => x.hidden = true))
    document.addEventListener('click', e => { const c = e.target.closest('[data-cmd]'); if (c) open(c.dataset.cmd) })

    // THE COMMAND PALETTE: every command, panel, layout and parameter by name
    const pal = $('#palette'), input = $('#palette input'), list = $('#palette .items')
    let sel = 0, shown = []
    const palette = (q = '') => { pal.hidden = false; input.value = q; filter(); input.focus() }
    const filter = () => {
        const q = input.value.toLowerCase()
        shown = COMMANDS.filter(c => (c.menu + ' ' + c.label + ' ' + c.keys).toLowerCase().includes(q)).slice(0, 12)
        sel = 0
        list.innerHTML = shown.map((c, i) => `<div class="item${i ? '' : ' hi'}" data-i="${i}">${c.label}<span class="where">${c.menu}${c.keys ? ' · ' + c.keys : ''}</span></div>`).join('') || '<div class="item note">nothing matches</div>'
        list.querySelectorAll('[data-i]').forEach(d => d.onclick = () => { pal.hidden = true; shown[d.dataset.i].run() })
    }
    input.oninput = filter
    input.onkeydown = e => {
        if (e.key === 'Escape') pal.hidden = true
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { sel = (sel + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % Math.max(1, shown.length); list.querySelectorAll('.item').forEach((d, i) => d.classList.toggle('hi', i === sel)) }
        if (e.key === 'Enter' && shown[sel]) { pal.hidden = true; shown[sel].run() }
    }
    $('#search').onfocus = () => { $('#search').blur(); palette() }
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || (e.shiftKey && e.key.toLowerCase() === 'p'))) { e.preventDefault(); palette() }
        if (e.key === 'F1') { e.preventDefault(); open('help') }
    })
    pal.addEventListener('click', e => { if (e.target === pal) pal.hidden = true })

    // TOOLTIPS and context help, from the same text
    const tipEl = $('#tip')
    let tmr = 0
    document.addEventListener('pointerover', e => {
        const t = e.target.closest('[data-tip]')
        clearTimeout(tmr); tipEl.hidden = true
        if (!t) return
        helpShow(t.textContent.trim().slice(0, 40) || 'This control', t.dataset.tip)
        tmr = setTimeout(() => {
            const r = t.getBoundingClientRect()
            tipEl.innerHTML = `${t.dataset.tip}<span class="k">F1 for more</span>`
            tipEl.hidden = false
            tipEl.style.left = `${Math.min(innerWidth - tipEl.offsetWidth - 8, Math.max(8, r.left))}px`
            tipEl.style.top = `${r.bottom + 6 + tipEl.offsetHeight > innerHeight ? r.top - tipEl.offsetHeight - 6 : r.bottom + 6}px`
        }, 450)
    })
    document.addEventListener('pointerdown', () => { clearTimeout(tmr); tipEl.hidden = true })

    // THE TOUR: a few coach marks over the real parts
    const STEPS = [
        ['.menubar .menus', 'The menu bar holds every command, with its shortcut. Ctrl K finds any of them by name, and any parameter too.'],
        ['.presets', 'Layouts: Design, Analyse, Render, Animate, and your own. Each shows the panels its stage needs. Rearrange freely, then ＋ to keep it.'],
        ['.dv-tab', 'Every panel is a tab: drag it to dock anywhere, drop it on another monitor with ⇱, float it with ⧉. The coloured mark says which part of the program it belongs to.'],
        ['[data-panel="library"], [data-panel="viewport"]', 'The library: objects, lights and materials, built in and your own. Drag them into the scene.'],
    ]
    const coach = $('#coach')
    const tour = i => {
        if (i >= STEPS.length) { coach.hidden = true; return }
        const t = document.querySelector(STEPS[i][0]), r = t?.getBoundingClientRect() ?? { left: 100, bottom: 100 }
        coach.innerHTML = `<div>${STEPS[i][1]}</div><div class="nav"><span class="note">${i + 1} / ${STEPS.length}</span><span class="spacer"></span><button data-x>Close</button><button class="primary" data-n>${i + 1 < STEPS.length ? 'Next' : 'Done'}</button></div>`
        coach.hidden = false
        coach.style.left = `${Math.min(innerWidth - 340, Math.max(8, r.left))}px`; coach.style.top = `${Math.min(innerHeight - 140, r.bottom + 10)}px`
        coach.querySelector('[data-n]').onclick = () => tour(i + 1); coach.querySelector('[data-x]').onclick = () => { coach.hidden = true }
    }
    if (!localStorage.getItem('mock.toured')) { try { localStorage.setItem('mock.toured', '1') } catch { } setTimeout(() => tour(0), 600) }
    window.TOUR = tour
}
