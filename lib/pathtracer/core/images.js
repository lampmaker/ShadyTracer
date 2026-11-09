//======================================================================================================================
// IMAGES ON SURFACES (0.84.0; roadmap/TEXTURES.md T1) -- a picture a material reads where a ray hits it: as its colour, as
// its glow, or in its code. The engine's side: the lookup in WGSL, its twin in JS, and the atlas every image of a scene
// sits in.
//
// NO UVs. A surface here is distance code (FEATURES.md 1), so a position on the picture comes from PROJECTING THE HIT:
// the point in its object's pattern frame (model.js version 24: p_local, R_local, S_local -- builder/codegen.js
// emitMaterials), in real millimetres, by one of five projections (PROJECTIONS). Then a size (one copy of the picture,
// in mm), an offset and a turn in the picture's plane, and a wrap mode for each axis.
//
// ONE TEXTURE FOR EVERY IMAGE, READ BY HAND. Every image of a scene is packed into one rgba8unorm texture (packImages),
// each at its own rectangle, which the slot's uniform carries. A lookup is four textureLoads mixed in the shader, not a
// sampler:
//   - wrap and mirror are exact, on the image's own texels: hardware addressing would wrap the whole atlas, and its
//     filtering at an image's edge would blend in the neighbour's texels;
//   - the position inside a texel is f32 (hardware filtering quantises it to 1/256: roadmap/IMPORT.md);
//   - each tap is decoded from sRGB before the four are mixed, which is the order an -srgb format would do it in;
//   - no sampler binding, and the number of bindings does not grow with the number of images.
// No mipmaps: a compute shader has no derivatives, and every sample jitters its pixel, so the mean of point lookups over
// a pixel is the picture filtered over it (inferred, from the estimator; a far-off fine picture is noisier per sample,
// not wrong -- roadmap/TEXTURES.md 3 says what would test it).
//
// THE TEXEL READ IS EACH KERNEL'S OWN (imageTexelWGSL). Every kernel that holds the scene holds getMaterial2's text, but
// only some reach it from main -- the renderer's march and shadow rays ask the distance alone (wavefront.js distOnly).
// tinywebgpu declares a binding the text names, and layout:'auto' keeps only what main reaches: a texture named in a
// function main never calls is declared, bound, and missing from the layout -- an invalid bind group (check-shaders pass
// 2 says so as UNREACHABLE). So the scene's text calls imageTexel() and does not define it; withImages() gives a kernel
// the real one where main reaches it and a stub that reads nothing where it does not, from the call graph
// (wgslgraph.js) of the kernel's own text.
//
// THE SLOT is one mat4x4<f32> uniform (slotMatrix), its columns:
//   0  the image's rectangle in the atlas: x, y, width, height in texels (width 0: no image -- reads transparent)
//   1  one copy's size in mm (x, y), and the offset of its centre in mm (x, y)
//   2  cos and sin of the turn, the projection, the flags (wrap u, wrap v, filter, faces, colour, 16-bit: slotFlags)
//   3  the triplanar blend's sharpness; the bound on the picture's height gradient per mm (heightSteep); two words unused
//
// A 16-BIT GREY PICTURE (a height map, 0.84.0) is in the atlas as two bytes a texel: its high byte in red, its low in
// green, its alpha's high byte in alpha (pack16). The browser decodes every picture to 8 bits, so such a picture is
// decoded here (builder/images.js decodePNG) and written so, and every read of it puts the two bytes back together.
//
// A PICTURE AS A HEIGHT (0.84.0; heightAt, a material's relief): its luminance times its alpha, 0 to 1, read planar from
// the point's x and y in mm -- a function of the point alone, so a bound on its gradient is a property of the picture
// and its placement, worked out once on the host from its pixels (heightStats, heightSteep) and carried in the slot.
// SMOOTH: a cubic B-spline of the pixels, sixteen of them a read. Bilinear's gradient jumps at every texel's edge, and a
// relief's normal is taken by differences of its height, so the texel grid would show in the shading; the B-spline's is
// continuous. Its derivative is a quadratic B-spline of the differences between neighbouring texels, so it is never
// more than the largest of them: that is the bound. Wrap none fades to 0 over the texels past the copy -- a step to 0
// would have no bound at all -- and repeat counts the seam's differences, the last texel against the first.
//======================================================================================================================
import { functionsOf } from './wgslgraph.js'

/** The scene resource every image is in: one texture (codegen declares it, scene.init makes it). */
export const IMAGE_RESOURCE = 'sceneImages'
export const IMAGE_TYPE = 'texture_2d<f32>'
/** The longest edge an image may have on import (roadmap/TEXTURES.md, decision 3): a larger one is scaled down to it. */
export const IMAGE_MAX_EDGE = 4096
/** The largest atlas side: WebGPU's default maxTextureDimension2D, which every adapter offers. */
export const ATLAS_MAX = 8192

/* THE SETTINGS, as the file writes them, and their codes in the slot */
export const PROJECTIONS = ['planar', 'box', 'triplanar', 'cylindrical', 'spherical']
export const WRAPS = ['repeat', 'mirror', 'clamp', 'none']
export const FILTERS = ['smooth', 'pixels']
export const FACES = ['front', 'both', 'all']
export const USES = ['none', 'colour']

/** A slot's settings when it is made: a picture 100 mm wide, planar, repeated, on the front faces, read as colour. */
export const SLOT_DEFAULTS = Object.freeze({
    use: 'colour', projection: 'planar', size: Object.freeze({ x: 100, y: 100 }), offset: Object.freeze({ x: 0, y: 0 }), turn: 0,
    wrapU: 'repeat', wrapV: 'repeat', filter: 'smooth', faces: 'front', colour: true, sharpness: 4,
})

/** A slot's flags word: wrap u (2 bits), wrap v (2), filter (1), faces (2), colour (1). */
export const slotFlags = (s, entry = null) => WRAPS.indexOf(s.wrapU ?? 'repeat') | (WRAPS.indexOf(s.wrapV ?? 'repeat') << 2)
    | (FILTERS.indexOf(s.filter ?? 'smooth') << 4) | (FACES.indexOf(s.faces ?? 'front') << 5) | ((s.colour ?? true) ? 128 : 0)
    | (entry?.bits === 16 ? 256 : 0)

/**
 * A slot's uniform: 16 numbers, column by column (WGSL's mat4x4 order, as tinywebgpu packs one).
 * @param slot  the material's slot (model.js IMAGE_SLOT): its settings
 * @param rect  its image's rectangle in the atlas { x, y, w, h }, or null when the image is missing (reads transparent)
 * @param entry its picture's entry (builder/images.js), for its depth and its heights' bound; none: 8 bits, no bound
 */
export function slotMatrix(slot, rect, entry = null) {
    const s = { ...SLOT_DEFAULTS, ...slot }
    const t = (s.turn ?? 0) * Math.PI / 180
    return [
        rect?.x ?? 0, rect?.y ?? 0, rect?.w ?? 0, rect?.h ?? 0,
        s.size.x, s.size.y, s.offset.x, s.offset.y,
        Math.cos(t), Math.sin(t), PROJECTIONS.indexOf(s.projection), slotFlags(s, entry),
        s.sharpness ?? 4, rect ? heightSteep(s, entry) : 0, 0, 0,
    ]
}

/** THE BOUND ON A PICTURE'S HEIGHT GRADIENT, per mm, as a slot places it (the header: A PICTURE AS A HEIGHT): its largest
 *  texel-to-texel differences across and up (heightStats: within the picture, across a repeat's seam, against the 0
 *  past a copy that does not wrap), times the texels per mm each way. A turn turns the gradient and leaves its length.
 *  0 for a picture whose heights were never worked out (an entry from before them): heightAt then reads it flat. */
export function heightSteep(slot, entry) {
    const st = entry?.heights?.[(slot.colour ?? true) ? 'colour' : 'data']
    if (!st || !(entry.width > 0) || !(entry.height > 0)) return 0
    const [ix, iy, seamX, seamY, edgeX, edgeY] = st
    const along = (wrap, inner, seam, edge) => Math.max(inner, wrap === 'repeat' ? seam : 0, wrap === 'none' ? edge : 0)
    const gx = along(slot.wrapU ?? 'repeat', ix, seamX, edgeX) * entry.width / Math.max(slot.size?.x ?? 100, 1e-6)
    const gy = along(slot.wrapV ?? 'repeat', iy, seamY, edgeY) * entry.height / Math.max(slot.size?.y ?? 100, 1e-6)
    return Math.hypot(gx, gy)
}

/**
 * THE ATLAS: every image a shelf of its own height or a place on one, tallest first, then by key -- the same layout for
 * the same images whoever asks (codegen for the slots' rectangles, scene.init to put the pixels there). Its width is the
 * widest image or a power of two up to the sum of their areas' square root, whichever is larger; its height what the
 * shelves take. Throws when they do not fit in ATLAS_MAX square.
 * @param images  [{ key, width, height }]
 * @returns { width, height, rects: Map key -> { x, y, w, h } }
 */
export function packImages(images) {
    const list = [...images].filter(i => i.width > 0 && i.height > 0)
        .sort((a, b) => b.height - a.height || b.width - a.width || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    const rects = new Map()
    if (!list.length) return { width: 1, height: 1, rects }
    const widest = Math.max(...list.map(i => i.width))
    const area = list.reduce((s, i) => s + i.width * i.height, 0)
    let W = 1
    while (W < Math.sqrt(area)) W *= 2
    W = Math.min(ATLAS_MAX, Math.max(W, widest))
    let x = 0, y = 0, shelf = 0
    for (const i of list) {
        if (x + i.width > W) { y += shelf; x = 0; shelf = 0 }
        rects.set(i.key, { x, y, w: i.width, h: i.height })
        x += i.width; shelf = Math.max(shelf, i.height)
    }
    const H = y + shelf
    if (widest > ATLAS_MAX || H > ATLAS_MAX)
        throw new Error(`the scene's images do not fit in one ${ATLAS_MAX} x ${ATLAS_MAX} texture (they would take ${W} x ${H}): use smaller images or fewer of them`)
    return { width: W, height: H, rects }
}

//----------------------------------------------------------------------------------------------------------------------
// THE LOOKUP IN WGSL. imageTexel(ix) is the kernel's (imageTexelWGSL below); everything here is the scene's.
//----------------------------------------------------------------------------------------------------------------------
export const IMAGES_WGSL = /*wgsl*/`
// IMAGES ON SURFACES (core/images.js): a slot is a mat4x4 -- its rectangle, size and offset, turn, projection, flags
fn imgWrap(i: i32, n: i32, mode: u32) -> i32 {
    if (mode == 0u) { return ((i % n) + n) % n; }                                   // repeat
    if (mode == 1u) { let k = ((i % (2 * n)) + 2 * n) % (2 * n); return select(2 * n - 1 - k, k, k < n); }   // mirror
    return clamp(i, 0, n - 1);                                                      // clamp, and none inside its copy
}
fn imgDecode(c: vec4<f32>, colour: bool) -> vec4<f32> {
    if (!colour) { return c; }
    let lo = c.rgb / 12.92;
    let hi = pow((c.rgb + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    return vec4<f32>(select(hi, lo, c.rgb <= vec3<f32>(0.04045)), c.a);
}
// a texel as the picture has it: a 16-bit grey one put back together from its two bytes (the header), then decoded
fn imgValue(c: vec4<f32>, colour: bool, deep: bool) -> vec4<f32> {
    if (!deep) { return imgDecode(c, colour); }
    let v = (round(c.r * 255.0) * 256.0 + round(c.g * 255.0)) / 65535.0;
    return imgDecode(vec4<f32>(v, v, v, c.a), colour);
}
fn imgTap(s: mat4x4<f32>, i: vec2<i32>, wu: u32, wv: u32, colour: bool) -> vec4<f32> {
    let n = vec2<i32>(s[0].zw);
    let j = vec2<i32>(imgWrap(i.x, n.x, wu), imgWrap(i.y, n.y, wv));
    return imgValue(imageTexel(vec2<i32>(s[0].xy) + j), colour, ((u32(s[2].w + 0.5) >> 8u) & 1u) != 0u);
}
/* THE PICTURE AT uv, in copies of it: (0, 0) its bottom left corner, (1, 1) its top right. Linear rgb (a colour image
   decoded from sRGB) and alpha; transparent outside a copy that does not wrap, and with no image. */
fn imageAt(s: mat4x4<f32>, uv: vec2<f32>) -> vec4<f32> {
    let n = s[0].zw;
    if (!(n.x >= 1.0 && n.y >= 1.0)) { return vec4<f32>(0.0); }
    let f = u32(s[2].w + 0.5);
    let wu = f & 3u;
    let wv = (f >> 2u) & 3u;
    let pixels = ((f >> 4u) & 1u) != 0u;
    let colour = ((f >> 7u) & 1u) != 0u;
    if ((wu == 3u && (uv.x < 0.0 || uv.x > 1.0)) || (wv == 3u && (uv.y < 0.0 || uv.y > 1.0))) { return vec4<f32>(0.0); }
    // a NaN, or a position past 1e5 copies, whose texel would not fit an i32
    if (!(abs(uv.x) < 1.0e5 && abs(uv.y) < 1.0e5)) { return vec4<f32>(0.0); }
    let t = vec2<f32>(uv.x, 1.0 - uv.y) * n;          // texels; the image's first row is its top
    if (pixels) { return imgTap(s, vec2<i32>(floor(t)), wu, wv, colour); }
    let x = t - vec2<f32>(0.5);
    let i = vec2<i32>(floor(x));
    let w = x - floor(x);
    let a = imgTap(s, i, wu, wv, colour);
    let b = imgTap(s, i + vec2<i32>(1, 0), wu, wv, colour);
    let c = imgTap(s, i + vec2<i32>(0, 1), wu, wv, colour);
    let d = imgTap(s, i + vec2<i32>(1, 1), wu, wv, colour);
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
// a position in the picture's plane, in mm, to copies of it: less the offset, turned back, over the size, centred
fn imgPlane(s: mat4x4<f32>, t: vec2<f32>) -> vec2<f32> {
    let d = t - s[1].zw;
    let r = vec2<f32>(s[2].x * d.x + s[2].y * d.y, -s[2].y * d.x + s[2].x * d.y);
    return r / max(s[1].xy, vec2<f32>(1.0e-6)) + vec2<f32>(0.5);
}
/* A FACE OF THE BOX, read the right way round from outside it, z up for the four sides: axis 0 x, 1 y, 2 z */
fn imgFace(q: vec3<f32>, axis: u32, sgn: f32) -> vec2<f32> {
    if (axis == 0u) { return vec2<f32>(sgn * q.y, q.z); }
    if (axis == 1u) { return vec2<f32>(-sgn * q.x, q.z); }
    return vec2<f32>(sgn * q.x, q.y);
}
fn imgAxis(nl: vec3<f32>) -> u32 {
    let a = abs(nl);
    if (a.x >= a.y && a.x >= a.z) { return 0u; }
    if (a.y >= a.z) { return 1u; }
    return 2u;
}
fn imgSign(v: f32) -> f32 { return select(-1.0, 1.0, v >= 0.0); }
/* WHERE ON THE PICTURE: q the point in the pattern frame in mm, nl the normal in it. (uv in copies, 1 if the face
   shows the picture, else 0.) A triplanar slot answers for the face its normal is nearest. */
fn imageMapped(s: mat4x4<f32>, q: vec3<f32>, nl: vec3<f32>) -> vec3<f32> {
    let proj = u32(s[2].z + 0.5);
    let faces = (u32(s[2].w + 0.5) >> 5u) & 3u;
    if (proj == 0u) {                                                               // planar, along z
        let shows = faces == 2u || (faces == 1u && abs(nl.z) > 1.0e-3) || (faces == 0u && nl.z > 1.0e-3);
        return vec3<f32>(imgPlane(s, q.xy), select(0.0, 1.0, shows));
    }
    if (proj == 3u) {                                                               // cylindrical, round z
        let r = length(q.xy);
        return vec3<f32>(imgPlane(s, vec2<f32>(atan2(q.y, q.x) * r, q.z)), 1.0);
    }
    if (proj == 4u) {                                                               // spherical: one copy the whole sphere
        let r = max(length(q), 1.0e-12);
        let lon = atan2(q.y, q.x) / 6.283185307179586;
        let lat = asin(clamp(q.z / r, -1.0, 1.0)) / 3.141592653589793;
        return vec3<f32>(imgPlane(s, vec2<f32>(lon, lat) * s[1].xy + s[1].zw), 1.0);
    }
    let k = imgAxis(nl);                                                            // box, and triplanar's nearest
    return vec3<f32>(imgPlane(s, imgFace(q, k, imgSign(nl[k]))), 1.0);
}
fn imageSample(s: mat4x4<f32>, q: vec3<f32>, nl: vec3<f32>) -> vec4<f32> {
    if (u32(s[2].z + 0.5) == 2u) {                                                  // triplanar: the three faces mixed
        var w = pow(abs(nl), vec3<f32>(max(s[3].x, 1.0)));
        let sum = w.x + w.y + w.z;
        if (!(sum > 0.0)) { return vec4<f32>(0.0); }
        w = w / sum;
        return imageAt(s, imgPlane(s, imgFace(q, 0u, imgSign(nl.x)))) * w.x
             + imageAt(s, imgPlane(s, imgFace(q, 1u, imgSign(nl.y)))) * w.y
             + imageAt(s, imgPlane(s, imgFace(q, 2u, imgSign(nl.z)))) * w.z;
    }
    let m = imageMapped(s, q, nl);
    if (m.z < 0.5) { return vec4<f32>(0.0); }
    return imageAt(s, m.xy);
}
/* A PICTURE AS A HEIGHT (the header): luminance times alpha, 0 to 1, at texel i -- past a copy that does not wrap, 0 */
fn imgHeightTap(s: mat4x4<f32>, i: vec2<i32>, wu: u32, wv: u32, colour: bool) -> f32 {
    let n = vec2<i32>(s[0].zw);
    if ((wu == 3u && (i.x < 0 || i.x >= n.x)) || (wv == 3u && (i.y < 0 || i.y >= n.y))) { return 0.0; }
    let c = imgTap(s, i, wu, wv, colour);
    return dot(c.rgb, vec3<f32>(0.2126, 0.7152, 0.0722)) * c.a;
}
// the cubic B-spline's four weights at fraction f
fn imgBspline(f: f32) -> vec4<f32> {
    let g = 1.0 - f;
    return vec4<f32>(g * g * g, 3.0 * f * f * f - 6.0 * f * f + 4.0, -3.0 * f * f * f + 3.0 * f * f + 3.0 * f + 1.0, f * f * f) / 6.0;
}
/* THE PICTURE'S HEIGHT AT q (mm, in the object's pattern frame), planar from q.xy whatever the slot's projection --
   (height 0 to 1, the bound on its gradient per mm); (0, 0) with no picture. What a relief's code calls. */
fn heightAt(s: mat4x4<f32>, q: vec3<f32>) -> vec2<f32> {
    let n = s[0].zw;
    if (!(n.x >= 1.0 && n.y >= 1.0)) { return vec2<f32>(0.0); }
    let uv = imgPlane(s, q.xy);
    if (!(abs(uv.x) < 1.0e5 && abs(uv.y) < 1.0e5)) { return vec2<f32>(0.0); }
    let f = u32(s[2].w + 0.5);
    let wu = f & 3u;
    let wv = (f >> 2u) & 3u;
    let colour = ((f >> 7u) & 1u) != 0u;
    let x = vec2<f32>(uv.x, 1.0 - uv.y) * n - vec2<f32>(0.5);
    let i = vec2<i32>(floor(x));
    let wx = imgBspline(x.x - floor(x.x));
    let wy = imgBspline(x.y - floor(x.y));
    var h = 0.0;
    for (var b = 0; b < 4; b++) {
        var row = 0.0;
        for (var a = 0; a < 4; a++) { row += wx[a] * imgHeightTap(s, i + vec2<i32>(a - 1, b - 1), wu, wv, colour); }
        h += wy[b] * row;
    }
    return vec2<f32>(clamp(h, 0.0, 1.0), s[3].y);
}

/* WHAT A MATERIAL'S CODE CALLS (builder/codegen.js puts IMG_Q and IMG_N in place before its code): its slots by name */
var<private> IMG_Q: vec3<f32>;
var<private> IMG_N: vec3<f32>;
fn sample(s: mat4x4<f32>) -> vec4<f32> { return imageSample(s, IMG_Q, IMG_N); }
fn mapped(s: mat4x4<f32>) -> vec2<f32> { return imageMapped(s, IMG_Q, IMG_N).xy; }
fn sampleAt(s: mat4x4<f32>, uv: vec2<f32>) -> vec4<f32> { return imageAt(s, uv); }
`

/** A kernel's own texel read: the atlas where `reached`, else a stub that names nothing (the header says why). */
export const imageTexelWGSL = reached => reached
    ? `\nfn imageTexel(ix: vec2<i32>) -> vec4<f32> { return textureLoad(${IMAGE_RESOURCE}, ix, 0); }\n`
    : '\nfn imageTexel(ix: vec2<i32>) -> vec4<f32> { return vec4<f32>(0.0); }   // this kernel never reaches a material\n'

/** Whether `fn target` is reachable from a kernel's main in its text (wgslgraph.js's call graph). The text calls the
 *  texel read without defining it (withImages adds it), and the graph counts only calls to functions it has: a stand-in
 *  definition joins it for the question. */
export function reaches(text, main, target = 'imageTexel') {
    const fns = functionsOf(`${text}${target === 'imageTexel' ? imageTexelWGSL(false) : ''}\nfn __entry__() {\n${main}\n}`)
    const seen = new Set(['__entry__']), todo = ['__entry__']
    while (todo.length) {
        const f = fns.get(todo.pop())
        for (const c of f?.calls ?? []) if (fns.has(c) && !seen.has(c)) { if (c === target) return true; seen.add(c); todo.push(c) }
    }
    return false
}

/** A KERNEL'S TEXT WITH ITS TEXEL READ: unchanged for a scene with no image (its text is the one it always was); else
 *  with imageTexel defined -- reading the atlas where main reaches it, a stub where not. Every kernel that holds the
 *  scene's text passes its text and main through this. */
export function withImages(scene, text, main) {
    if (!scene?.resources?.[IMAGE_RESOURCE]) return text
    return text + imageTexelWGSL(reaches(text, main))
}

//----------------------------------------------------------------------------------------------------------------------
// THE TWIN IN JS: the same lookup on an image's own pixels, for the tests (core/test/images.test.mjs) and for anything
// on the host that wants a picture's value where the GPU reads it. Each function is the WGSL one of the same name.
//----------------------------------------------------------------------------------------------------------------------
const srgbToLinear = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
const mod = (a, n) => ((a % n) + n) % n
export function imgWrapJS(i, n, mode) {
    if (mode === 0) return mod(i, n)
    if (mode === 1) { const k = mod(i, 2 * n); return k < n ? k : 2 * n - 1 - k }
    return Math.min(n - 1, Math.max(0, i))
}
/**
 * @param s      a slotMatrix
 * @param img    { width, height, pixels }: the image alone, rgba 0..255 a texel, first row its top
 * @param uv     [u, v] in copies
 * @returns [r, g, b, a]
 */
export function imageAtJS(s, img, [u, v]) {
    const W = s[2], H = s[3]
    if (!(W >= 1 && H >= 1)) return [0, 0, 0, 0]
    const f = Math.round(s[11]), wu = f & 3, wv = (f >> 2) & 3, pixels = (f >> 4) & 1, colour = (f >> 7) & 1
    if ((wu === 3 && (u < 0 || u > 1)) || (wv === 3 && (v < 0 || v > 1))) return [0, 0, 0, 0]
    if (!(Math.abs(u) < 1e5 && Math.abs(v) < 1e5)) return [0, 0, 0, 0]
    const tap = (i, j) => texelValueJS(img, imgWrapJS(i, W, wu), imgWrapJS(j, H, wv), colour, (f >> 8) & 1)
    const tx = u * W, ty = (1 - v) * H
    if (pixels) return tap(Math.floor(tx), Math.floor(ty))
    const x = tx - 0.5, y = ty - 0.5, i = Math.floor(x), j = Math.floor(y), wx = x - i, wy = y - j
    const a = tap(i, j), b = tap(i + 1, j), c = tap(i, j + 1), d = tap(i + 1, j + 1)
    return a.map((_, k) => (a[k] * (1 - wx) + b[k] * wx) * (1 - wy) + (c[k] * (1 - wx) + d[k] * wx) * wy)
}
/** A texel as the picture has it (imgValue): the atlas's bytes, a 16-bit grey one's put back together, then decoded. */
export function texelValueJS(img, x, y, colour, deep) {
    const o = 4 * (y * img.width + x)
    let c = [0, 1, 2, 3].map(k => img.pixels[o + k] / 255)
    if (deep) { const v = (img.pixels[o] * 256 + img.pixels[o + 1]) / 65535; c = [v, v, v, c[3]] }
    return colour ? [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]), c[3]] : c
}
const heightOfJS = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) * c[3]
const bsplineJS = f => { const g = 1 - f; return [g * g * g, 3 * f ** 3 - 6 * f * f + 4, -3 * f ** 3 + 3 * f * f + 3 * f + 1, f ** 3].map(w => w / 6) }
/** heightAt in JS: [height 0 to 1, the slot's bound]. */
export function heightAtJS(s, img, q) {
    const W = s[2], H = s[3]
    if (!(W >= 1 && H >= 1)) return [0, 0]
    const [u, v] = imgPlaneJS(s, [q[0], q[1]])
    if (!(Math.abs(u) < 1e5 && Math.abs(v) < 1e5)) return [0, 0]
    const f = Math.round(s[11]), wu = f & 3, wv = (f >> 2) & 3, colour = (f >> 7) & 1, deep = (f >> 8) & 1
    const tap = (i, j) => (wu === 3 && (i < 0 || i >= W)) || (wv === 3 && (j < 0 || j >= H)) ? 0
        : heightOfJS(texelValueJS(img, imgWrapJS(i, W, wu), imgWrapJS(j, H, wv), colour, deep))
    const x = u * W - 0.5, y = (1 - v) * H - 0.5, i = Math.floor(x), j = Math.floor(y)
    const wx = bsplineJS(x - i), wy = bsplineJS(y - j)
    let h = 0
    for (let b = 0; b < 4; b++) { let row = 0; for (let a = 0; a < 4; a++) row += wx[a] * tap(i + a - 1, j + b - 1); h += wy[b] * row }
    return [Math.min(1, Math.max(0, h)), s[13]]
}
/**
 * WHAT A PICTURE'S HEIGHTS BOUND (the header: A PICTURE AS A HEIGHT), from its pixels as the atlas holds them:
 * { colour, data }, each [the largest difference across between neighbouring texels, up, across a repeat's seam (its last
 * column against its first), up one, and the largest height on its left or right column (against the 0 past a copy that
 * does not wrap), on its top or bottom row] -- heights 0 to 1, read as colour (decoded from sRGB) and as data.
 * @param img   { width, height, pixels }: rgba bytes, a 16-bit grey picture's packed (pack16)
 */
export function heightStats(img, { bits = 8 } = {}) {
    const { width: W, height: H } = img, deep = bits === 16 ? 1 : 0
    const out = {}
    for (const [name, colour] of [['colour', 1], ['data', 0]]) {
        const h = new Float64Array(W * H)
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) h[y * W + x] = heightOfJS(texelValueJS(img, x, y, colour, deep))
        let ix = 0, iy = 0, sx = 0, sy = 0, ex = 0, ey = 0
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const v = h[y * W + x]
            if (x + 1 < W) ix = Math.max(ix, Math.abs(h[y * W + x + 1] - v))
            if (y + 1 < H) iy = Math.max(iy, Math.abs(h[(y + 1) * W + x] - v))
            if (x === 0 || x === W - 1) ex = Math.max(ex, v)
            if (y === 0 || y === H - 1) ey = Math.max(ey, v)
        }
        for (let y = 0; y < H; y++) sx = Math.max(sx, Math.abs(h[y * W] - h[y * W + W - 1]))
        for (let x = 0; x < W; x++) sy = Math.max(sy, Math.abs(h[x] - h[(H - 1) * W + x]))
        out[name] = [ix, iy, sx, sy, ex, ey].map(v => Number(v.toPrecision(7)) + 1e-7)     // rounded up, never under
    }
    return out
}
/** A 16-bit grey picture as the atlas holds it (the header): rgba bytes, high byte in red, low in green, alpha's high byte. */
export function pack16(gray, alpha, width, height) {
    const px = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
        px[4 * i] = gray[i] >> 8; px[4 * i + 1] = gray[i] & 255; px[4 * i + 3] = alpha ? alpha[i] >> 8 : 255
    }
    return px
}
export function imgPlaneJS(s, [tx, ty]) {
    const dx = tx - s[6], dy = ty - s[7]
    return [(s[8] * dx + s[9] * dy) / Math.max(s[4], 1e-6) + 0.5, (-s[9] * dx + s[8] * dy) / Math.max(s[5], 1e-6) + 0.5]
}
export const imgFaceJS = (q, axis, sgn) => axis === 0 ? [sgn * q[1], q[2]] : axis === 1 ? [-sgn * q[0], q[2]] : [sgn * q[0], q[1]]
export const imgAxisJS = nl => { const a = nl.map(Math.abs); return a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2 }
const sgnJS = v => v >= 0 ? 1 : -1
/** [u, v, shows] */
export function imageMappedJS(s, q, nl) {
    const proj = Math.round(s[10]), faces = (Math.round(s[11]) >> 5) & 3
    if (proj === 0) {
        const shows = faces === 2 || (faces === 1 && Math.abs(nl[2]) > 1e-3) || (faces === 0 && nl[2] > 1e-3)
        return [...imgPlaneJS(s, [q[0], q[1]]), shows ? 1 : 0]
    }
    if (proj === 3) return [...imgPlaneJS(s, [Math.atan2(q[1], q[0]) * Math.hypot(q[0], q[1]), q[2]]), 1]
    if (proj === 4) {
        const r = Math.max(Math.hypot(...q), 1e-12)
        const lon = Math.atan2(q[1], q[0]) / (2 * Math.PI), lat = Math.asin(Math.max(-1, Math.min(1, q[2] / r))) / Math.PI
        return [...imgPlaneJS(s, [lon * s[4] + s[6], lat * s[5] + s[7]]), 1]
    }
    const k = imgAxisJS(nl)
    return [...imgPlaneJS(s, imgFaceJS(q, k, sgnJS(nl[k]))), 1]
}
export function imageSampleJS(s, img, q, nl) {
    if (Math.round(s[10]) === 2) {
        const k = Math.max(s[12], 1)
        let w = nl.map(c => Math.pow(Math.abs(c), k))
        const sum = w[0] + w[1] + w[2]
        if (!(sum > 0)) return [0, 0, 0, 0]
        w = w.map(c => c / sum)
        const out = [0, 0, 0, 0]
        for (let a = 0; a < 3; a++) {
            const c = imageAtJS(s, img, imgPlaneJS(s, imgFaceJS(q, a, sgnJS(nl[a]))))
            for (let i = 0; i < 4; i++) out[i] += c[i] * w[a]
        }
        return out
    }
    const m = imageMappedJS(s, q, nl)
    return m[2] < 0.5 ? [0, 0, 0, 0] : imageAtJS(s, img, [m[0], m[1]])
}

/** makeCompute for a kernel that holds the scene's text: the same call, its text given its texel read (withImages). Every
 *  such kernel is made through this, so a new one cannot forget it -- check-shaders builds them all against a scene with
 *  a picture, and a kernel that forgot would name imageTexel with no definition and fail to parse. */
export const sceneCompute = (WG, scene, text, main, ...rest) => WG.makeCompute(withImages(scene, text, main), main, ...rest)
