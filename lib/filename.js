//======================================================================================================================
// A SAVED FILE'S NAME, WITH THE TIME IT WAS SAVED: `render-2026-10-19_14-03-22.png`.
//
// Every picture and video used to be written under one fixed name (render.png, map.png, raytracer.mp4), so the second
// save of an afternoon was the browser's `render (1).png`, the next `render (2).png`, and which render was which was
// lost the moment the folder was sorted. The time a file was made says which it is, and sorts as it was made.
//
// LOCAL TIME, the clock the person reads, written largest unit first so a name sorts by when it was made, with no `:`
// (Windows refuses one in a file name) and no space. Two files of one name in the same second -- a chart saved twice
// at a click, the same picture saved again -- get `-2`, `-3`: the name is unique within this page, which is what a
// stamp to the second alone does not promise.
//
//   stampedName('render', 'png')    'render-2026-10-19_14-03-22.png'
//   stampedName('raytracer')        'raytracer-2026-10-19_14-03-22' (no extension: the caller adds it)
//   timestamp(date)                 '2026-10-19_14-03-22'
//======================================================================================================================

const pad = v => String(v).padStart(2, '0')

/** `date` in local time as YYYY-MM-DD_HH-MM-SS. */
export function timestamp(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
         + `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

/* the names given in the second last stamped, and how often each: a stamp of another second starts it over */
let second = '', given = new Map()

/** `base`, the time and `ext` (without its dot; none when empty): a name no other call on this page has had. */
export function stampedName(base, ext = '', date = new Date()) {
    const t = timestamp(date)
    if (t !== second) { second = t; given = new Map() }
    const name = `${base || 'file'}-${t}`
    const n = (given.get(name) ?? 0) + 1
    given.set(name, n)
    return (n > 1 ? `${name}-${n}` : name) + (ext ? `.${ext}` : '')
}
