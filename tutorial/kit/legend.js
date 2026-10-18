//======================================================================================================================
// THE KEY: what each colour and line means in every figure, drawn with the figures' own pen so it is in the style being
// read. One spec, shown on the contents page and on every card of the styles page (each card in its own style): a
// style is judged by whether its key reads, not only by its look.
//======================================================================================================================

export const legend = {
    // one column, a row a meaning: the words need the width (two columns ran into each other at a card's width)
    aspect: 1.78,
    world: { x: [0, 16], y: [-0.6, 8.6] },
    state: { demo: [2.6, 0] },
    drag: { demo: (s, p) => { s.demo = [Math.min(4.6, Math.max(0.6, p[0])), 0] } },
    draw(pen, s) {
        const row = (y, label, f) => { f(y); pen.label([5.3, y], label, { role: 'ink', size: 14 }) }
        row(8, 'camera ray: from the eye', y => pen.ray([0.4, y], [4.8, y], { role: 'cam', w: 1.2 }))
        row(7, 'lamp, and a ray of its light', y => { pen.bulb([0.6, y], { r: 6 }); pen.ray([1.2, y], [4.8, y], { role: 'light', w: 1.2 }) })
        row(6, 'a glowing line: a lamp or a glowing surface', y => pen.bar([0.9, y], [4.3, y], { id: 'l0' }))
        row(5, 'shadow ray that reached its light', y => pen.ray([0.4, y], [4.8, y], { role: 'shadow', w: 1.2, exact: false, id: 'l1' }))
        row(4, 'blocked: a ray stopped short', y => pen.ray([0.4, y], [4.8, y], { role: 'blocked', w: 1.2, exact: false, id: 'l2' }))
        row(3, 'normal: straight out of a surface', y => pen.ray([2.6, y - 0.35], [2.6, y + 0.45], { role: 'normal', w: 1.2, exact: false, id: 'l3' }))
        row(2, 'a step of the march (chapter 2)', y => pen.circle([2.6, y], 0.38, { role: 'step', w: 0.8, exact: true }))
        row(1, 'a solid shape', y => pen.circle([2.6, y], 0.42, { role: 'solid', fill: 'fill', w: 1.25, id: 'l4' }))
        row(0, 'a handle: drag it (along this row)', () => pen.handle('demo', s.demo))
    },
}
