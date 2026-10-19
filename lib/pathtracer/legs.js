//======================================================================================================================
// THE LEGS FROM ONE POINT TO THE NEXT: one coordinate at a time, dashed in each axis's colour. The builder's Points
// mode draws them to a path's or a profile's point from the one before it (builder/pointsmode.js THE LEGS), and the
// measure tool's ruler along each stretch between two picked points (measure/tool.js legsOf) -- the ruler's were a
// copy of the Points mode's until the user saw it (2026-10-19: "very similar to what is used in the point editor. Can
// you re-use that"). One stepping and one look here; each draws them through its own projection, the Points mode's
// from the object's own coordinates, the ruler's from the scene's.
//======================================================================================================================

/** Each axis's colour, the gizmo's (builder/gizmodraw.js COLOR): x red, y green, z blue; a profile's r as its x. */
export const AXIS_INK = { x: '#ff5555', r: '#ff5555', y: '#55dd55', z: '#5599ff' }
/** A leg's dashes, and its width: 2 where it is the one looked at (the Points mode's selected point, a ruler's), 1 else. */
export const LEG_DASH = [3, 3]
export const LEG_WIDTH = 2

/**
 * From `from` by `delta`, one coordinate at a time in their order: [{ axis, from, to, d }], each leg starting where the
 * one before ended, so the last ends at from + delta. A step that `keep` refuses is no leg but is still taken, so the
 * legs after it start where they should. By default only a step of 0 is refused.
 */
export function axisLegs(from, delta, keep = d => d !== 0) {
    const out = []
    let at = from
    delta.forEach((d, axis) => {
        const to = at.map((v, n) => n === axis ? v + d : v)
        if (keep(d)) out.push({ axis, from: at, to, d })
        at = to
    })
    return out
}
