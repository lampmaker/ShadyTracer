//======================================================================================================================
// THE COLOUR WHEELS (0.next) -- lift, gamma and gain as three discs, the colourist's way to tint shadows, midtones and
// highlights apart.
//
// A disc is a colour: its dot dragged towards red tints that part of the picture red, towards blue blue, the farther
// the stronger; at the centre, nothing. Red is to the right, green up and to the left, blue down and to the left --
// the axes darkroom/grade.js wheelTint spreads a point onto, 120 degrees apart, so a tint never brightens. A
// double-click puts the dot back at the centre. Each wheel's master (all three channels at once) is a slider row of
// the Darkroom's own, under the discs.
//
//   const W = makeWheels(host, { get: name => ({ x, y }), set: (name, { x, y }) => {}, onChange })
//   W.redraw()    after the settings changed from elsewhere
//
// lib/pathtracer/test/darkroomtools.check.mjs drives it in headless Chromium.
//======================================================================================================================

export const WHEELS = [['lift', 'Lift (shadows)'], ['gamma', 'Gamma (midtones)'], ['gain', 'Gain (highlights)']]

export function makeWheels(host, { get, set, onChange = () => { } }) {
    const wrap = document.createElement('div')
    Object.assign(wrap.style, { padding: '4px 8px 6px', display: 'flex', gap: '6px', justifyContent: 'space-between' })
    const discs = WHEELS.map(([name, label]) => {
        const col = document.createElement('div')
        Object.assign(col.style, { flex: '1 1 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', minWidth: '0' })
        const canvas = document.createElement('canvas')
        canvas.dataset.wheel = name
        canvas.title = `${label}: drag towards a colour; double-click to reset`
        Object.assign(canvas.style, { width: '100%', aspectRatio: '1', display: 'block', cursor: 'crosshair', touchAction: 'none' })
        const cap = document.createElement('div')
        cap.textContent = label.split(' ')[0]
        Object.assign(cap.style, { font: '11px/1 Arial, sans-serif', color: '#b9c4cd' })
        col.append(canvas, cap)
        wrap.append(col)
        return { name, canvas }
    })
    host.append(wrap)

    const draw = d => {
        const dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(d.canvas.clientWidth * dpr))
        const r = w / 2 - 2 * dpr, cx = w / 2
        // A disc with no room yet is not drawn: the page makes the wheels at its start, in a Darkroom not yet shown
        // (0 wide), and arc() throws on the negative radius that gives -- which ended installUI there, the boxes after
        // it never made. The ResizeObserver draws it once it has a size.
        if (r <= 0) return
        if (d.canvas.width !== w || d.canvas.height !== w) { d.canvas.width = w; d.canvas.height = w }
        const c = d.canvas.getContext('2d')
        c.clearRect(0, 0, w, w)
        // the hues round the rim: red at the right, green at 120 degrees, blue at 240 (counter-clockwise, y up)
        for (let a = 0; a < 360; a += 4) {
            c.beginPath(); c.moveTo(cx, cx)
            c.arc(cx, cx, r, -(a + 2.5) * Math.PI / 180, -(a - 2.5) * Math.PI / 180)
            c.closePath()
            c.fillStyle = `hsl(${a}, 70%, 45%)`
            c.fill()
        }
        const fade = c.createRadialGradient(cx, cx, 0, cx, cx, r)
        fade.addColorStop(0, 'rgba(40,40,40,1)'); fade.addColorStop(1, 'rgba(40,40,40,0.15)')
        c.fillStyle = fade; c.beginPath(); c.arc(cx, cx, r, 0, Math.PI * 2); c.fill()
        c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = dpr
        c.beginPath(); c.moveTo(cx - r, cx); c.lineTo(cx + r, cx); c.moveTo(cx, cx - r); c.lineTo(cx, cx + r); c.stroke()
        const { x, y } = get(d.name)
        c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1.5 * dpr
        c.beginPath(); c.arc(cx + x * r, cx - y * r, 4 * dpr, 0, Math.PI * 2); c.fill(); c.stroke()
    }
    const at = (d, e) => {
        const b = d.canvas.getBoundingClientRect(), r = b.width / 2 - 2
        let x = (e.clientX - b.left - b.width / 2) / r, y = -(e.clientY - b.top - b.height / 2) / r
        const len = Math.hypot(x, y)
        if (len > 1) { x /= len; y /= len }                   // the rim is as far as it goes
        return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }
    }
    for (const d of discs) {
        let held = false
        const move = e => { const p = at(d, e), o = get(d.name); if (p.x === o.x && p.y === o.y) return; set(d.name, p); draw(d); onChange() }
        d.canvas.addEventListener('pointerdown', e => {
            if (e.button !== 0) return
            held = true
            try { d.canvas.setPointerCapture(e.pointerId) } catch { }
            move(e)
            e.preventDefault()
        })
        d.canvas.addEventListener('pointermove', e => { if (held) move(e) })
        const end = e => { held = false; try { d.canvas.releasePointerCapture(e.pointerId) } catch { } }
        d.canvas.addEventListener('pointerup', end)
        d.canvas.addEventListener('pointercancel', end)
        d.canvas.addEventListener('dblclick', () => {
            const o = get(d.name)
            if (o.x === 0 && o.y === 0) return
            set(d.name, { x: 0, y: 0 }); draw(d); onChange()
        })
        try { new ResizeObserver(() => draw(d)).observe(d.canvas) } catch { }
        draw(d)
    }
    return { element: wrap, redraw: () => discs.forEach(draw) }
}
