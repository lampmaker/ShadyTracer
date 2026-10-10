//======================================================================================================================
// A FIXED SCENE FOR THE TESTS that name nodes by id -- bounds, codegen's picking, selection.
//
// NOT scenes/demo.json. For one commit these tests read that file, and the next edit of the demo
// (Ball and Slab moved out of Shapes) broke a selection test whose premise was "Ball is inside
// Shapes": a scene the user designs is not a fixture. This is the demo as it was built in code
// before it became a file, frozen here. check-shaders compiles the real demo.json with the other
// bundled scenes; these tests need a structure that holds still:
//   Ground | Shapes { Ball, Slab } | Carved { Block, Scoop } | Twisted { Column }
//======================================================================================================================
import * as M from '../model.js'
import { PALETTE_V3 } from '../materials.js'
import { modifierGroup } from '../modifiers.js'

const SLAB_CODE = [
    '// a rounded slab, offset to the right of the ball',
    'let q = p - VEC3(1.5, 0.0, 0.0);',
    'C = add_new(C, sdRoundedBox(q, size, bevel), MATERIAL);',
].join('\n')

/** The fixture as a document: one node the generator owns, one the user does, in a group,
 *  with the materials as a list. Fixed ids, so the tests can name them. */
export function demoDoc() {
    const d = M.createDoc({ title: 'Test fixture' })
    // the three materials the demo had as palette names, now as the data they were
    M.addMaterial(d, { id: 'chrome', label: 'Chrome', params: PALETTE_V3.MAT_MIRROR.params })
    M.addMaterial(d, { id: 'orange', label: 'Orange', params: PALETTE_V3.MAT_DIFF_ORANGE.params })
    M.addMaterial(d, { id: 'checker', label: 'Checker', params: PALETTE_V3.MAT_GROUNDPLANE.params,
        code: PALETTE_V3.MAT_GROUNDPLANE.code })
    /* THE GROUND: an infinite plane, normal +z (z is up in these scenes), at z = 0 of its own
       frame -- so its height is its transform's position, and moving it is live. Placed where
       the ball, the lowest thing here at radius 1.2, rests on it. The normal is exact, so it
       needs no differences, and the transform rotates it if the ground is tilted. */
    M.addObject(d, 'root', { id: 'ground', type: 'code', label: 'Ground', material: 'checker',
        code: '// infinite ground plane: normal +z, at z = 0 of this node (move it with the transform)\n'
            + 'C = add_new(C, VEC4(0.0, 0.0, 1.0, p.z), MATERIAL);',
        transform: { pos: { x: 0, y: 0, z: -1.2 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
    const g = M.addGroup(d, 'root', { id: 'shapes', label: 'Shapes' })
    M.addObject(d, g.id, { id: 'ball', primitive: 'sphere', label: 'Ball', material: 'chrome',
        params: { radius: 1.2 }, transform: { pos: { x: -1.5, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
    // written the way a user would write it: bare parameter names, a comment, three lines
    M.addObject(d, g.id, { id: 'slab', type: 'code', label: 'Slab', material: 'orange',
        params: { size: { x: 1.0, y: 1.0, z: 0.25 }, bevel: 0.1 }, code: SLAB_CODE })
    // a box with a ball smoothly cut out of it, tilted and lifted: a CSG group with a transform
    const carved = M.addGroup(d, 'root', { id: 'carved', label: 'Carved', blend: 0.1,
        transform: { pos: { x: 0, y: 3, z: 0 }, rot: { x: 0, y: 0, z: 30 }, scale: 1 } })
    M.addObject(d, carved.id, { id: 'block', type: 'code', label: 'Block', material: 'orange',
        code: [
            '// the base of the Carved group: its first child, so the ball below is cut out of it',
            '// sdRoundedBox(point, half-size, corner radius)',
            'C = add_new(C, sdRoundedBox(p, VEC3(0.8), 0.05), MATERIAL);',
        ].join('\n') })
    M.addObject(d, carved.id, { id: 'scoop', primitive: 'sphere', label: 'Scoop', params: { radius: 0.9 }, join: 'subtract',
        transform: { pos: { x: 0.6, y: 0.6, z: -0.6 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
    /* A GROUP WITH CODE: the twist modifier around a tall box, standing on the ground in front.
       It is here so the demo -- which check-shaders builds against every kernel -- has a
       children function and a warp() in it, not only the blocks that existed before group code.
       extent 0.6 is the box's reach from the axis, its corner at sqrt(0.4^2 + 0.4^2). */
    const twisted = M.addGroup(d, 'root', { ...modifierGroup('twist'), id: 'twisted', label: 'Twisted',
        params: { rate: 1.0, extent: 0.6 }, transform: { pos: { x: 0, y: -3, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
    M.addObject(d, twisted.id, { id: 'column', primitive: 'box', label: 'Column', material: 'orange',
        params: { size: { x: 0.4, y: 0.4, z: 1.2 }, rounding: 0.02 } })
    return d
}
