//======================================================================================================================
// THE KEY: what each colour and line means in every figure, drawn with the figures' own pen so it is in the style being
// read. One spec, shown on the contents page and on every card of the styles page (each card in its own style): a
// style is judged by whether its key reads, not only by its look.
//======================================================================================================================

export const legend = {
    aspect: 3.2,
    world: { x: [0, 16], y: [-0.4, 5.6] },
    state: { demo: [11.2, 0.6] },
    drag: { demo: (s, p) => { s.demo = [Math.min(15.4, Math.max(9.6, p[0])), Math.min(1.6, Math.max(0.1, p[1]))] } },
    draw(pen, s) {
        const row = (y, label, f) => { f(y); pen.label([5.3, y], label, { role: 'ink', size: 14 }) }
        row(5, 'camera ray: from the eye', y => pen.ray([0.4, y], [4.8, y], { role: 'cam', w: 1.2 }))
        row(4, 'lamp, and a ray of its light', y => { pen.bulb([0.6, y], { r: 6 }); pen.ray([1.2, y], [4.8, y], { role: 'light', w: 1.2 }) })
        row(3, 'shadow ray that reached its light', y => pen.ray([0.4, y], [4.8, y], { role: 'shadow', w: 1.2, exact: false, id: 'l1' }))
        row(2, 'blocked: a ray stopped short', y => pen.ray([0.4, y], [4.8, y], { role: 'blocked', w: 1.2, exact: false, id: 'l2' }))
        row(1, 'normal: straight out of a surface', y => pen.ray([2.6, y - 0.3], [2.6, y + 0.45], { role: 'normal', w: 1.2, exact: false, id: 'l3' }))
        row(0, 'a step of the march (chapter 2)', y => pen.circle([2.6, y], 0.38, { role: 'step', w: 0.8, exact: true }))
        pen.circle([12.2, 3.6], 1.1, { role: 'solid', fill: 'fill', w: 1.25, id: 'l4' })
        pen.label([13.6, 4.3], 'a solid shape', { size: 14 })
        pen.handle('demo', s.demo)
        pen.label([s.demo[0] + 0.55, s.demo[1]], 'a handle: drag it', { role: 'accent', size: 14 })
    },
}
