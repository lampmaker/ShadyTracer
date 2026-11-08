// node lib/pathtracer/core/test/images.test.mjs
//
// IMAGES ON SURFACES (core/images.js, 0.84.0), without a GPU: the lookup's JS twin against brute force written here from
// what each setting says -- every wrap mode at and past the edges, mirror's seamless edges, bilinear and nearest, the sRGB
// decode before the mix, each projection's position (planar both ways round, the box's face, triplanar's weights summing
// to 1, the cylinder's arc length, the sphere's poles) -- the slot's packing, the atlas's layout, and which kernels a
// texel read is given to. The WGSL against this twin is core/test/images.gpu.mjs.
import {
    packImages, slotMatrix, slotFlags, imageAtJS, imageMappedJS, imageSampleJS, imgWrapJS, withImages, reaches,
    IMAGE_RESOURCE, SLOT_DEFAULTS, ATLAS_MAX, IMAGES_WGSL, heightAtJS, heightStats, heightSteep, pack16,
} from '../images.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, tol = 1e-9) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol)
const lin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

// a 4 x 3 image whose every texel is its own: r = 20 x, g = 60 y, b 200, a 255 (first row its top)
const W = 4, H = 3
const img = { width: W, height: H, pixels: new Uint8Array(W * H * 4) }
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img.pixels.set([20 * x, 60 * y, 200, 255], 4 * (y * W + x))
const texel = (x, y, colour) => {
    const c = [20 * x / 255, 60 * y / 255, 200 / 255, 1]
    return colour ? [lin(c[0]), lin(c[1]), lin(c[2]), 1] : c
}
const at = { x: 0, y: 0, w: W, h: H }
const slot = o => slotMatrix({ ...SLOT_DEFAULTS, ...o }, at)

// ---- the wrap of a texel index
{
    const n = 4
    const rep = [-5, -4, -1, 0, 3, 4, 7, 8].map(i => imgWrapJS(i, n, 0))
    ok('repeat: the index modulo the size', near(rep, [3, 0, 3, 0, 3, 0, 3, 0]), rep)
    const mir = [-1, 0, 3, 4, 5, 7, 8, -4, -5].map(i => imgWrapJS(i, n, 1))
    ok('mirror: every other copy flipped, the edge texel twice where they meet', near(mir, [0, 0, 3, 3, 2, 0, 0, 3, 3]), mir)
    const cl = [-3, 0, 3, 9].map(i => imgWrapJS(i, n, 2))
    ok('clamp: the edge texel goes on', near(cl, [0, 0, 3, 3]), cl)
}

// ---- a texel's centre is that texel exactly, in either filter, decoded or not
for (const filter of ['smooth', 'pixels']) for (const colour of [true, false]) {
    const s = slot({ filter, colour })
    let all = true, worst = ''
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const uv = [(x + 0.5) / W, 1 - (y + 0.5) / H]
        const got = imageAtJS(s, img, uv), want = texel(x, y, colour)
        if (!near(got, want, 1e-12)) { all = false; worst = `${x},${y}: ${got} vs ${want}` }
    }
    ok(`${filter}, ${colour ? 'colour' : 'data'}: each texel's centre reads that texel`, all, worst)
}

// ---- bilinear: halfway between two texels is their mean, decoded first (not the decode of the mean)
{
    const s = slot({})
    const uv = [(1 + 1) / W, 1 - 0.5 / H]               // between texels 1 and 2 of the top row
    const got = imageAtJS(s, img, uv)
    const want = texel(1, 0, true).map((c, k) => (c + texel(2, 0, true)[k]) / 2)
    ok('smooth: halfway between two texels their mean, each decoded from sRGB first', near(got, want, 1e-12), `${got} vs ${want}`)
    const enc = (20 * 1.5) / 255
    ok('...which is not the decode of the encoded mean', Math.abs(got[0] - lin(enc)) > 1e-4)
    const px = imageAtJS(slot({ filter: 'pixels' }), img, uv)
    ok('pixels: the same point reads one texel, the one it is in', near(px, texel(2, 0, true), 1e-12), `${px}`)
}

// ---- the wrap modes on the picture: past the edges
{
    const mid = 1 - 0.5 / H                                 // the top row's height
    const u = x => [x, mid]
    // repeat: one copy on, the same texel
    ok('repeat: a copy to the right reads as the first', near(imageAtJS(slot({}), img, u(1.5 / W + 1)), imageAtJS(slot({}), img, u(1.5 / W)), 1e-12))
    // bilinear across the seam of a repeat: the last texel and the first, mixed
    const seam = imageAtJS(slot({}), img, u(1))
    const want = texel(3, 0, true).map((c, k) => (c + texel(0, 0, true)[k]) / 2)
    ok('repeat: across the seam, the last texel and the first mixed', near(seam, want, 1e-12), `${seam} vs ${want}`)
    // mirror: just past the edge reads what is just inside it, so the seam is continuous
    const a = imageAtJS(slot({ wrapU: 'mirror' }), img, u(1 + 0.3 / W)), b = imageAtJS(slot({ wrapU: 'mirror' }), img, u(1 - 0.3 / W))
    ok('mirror: as far past the edge as inside it, the same value (no seam)', near(a, b, 1e-12), `${a} vs ${b}`)
    // clamp: far past, the edge texel
    ok('clamp: far past the edge, the edge texel', near(imageAtJS(slot({ wrapU: 'clamp' }), img, u(7.3)), texel(3, 0, true), 1e-12))
    ok('clamp: far before it, the first', near(imageAtJS(slot({ wrapU: 'clamp' }), img, u(-7.3)), texel(0, 0, true), 1e-12))
    // none: transparent outside its copy, and the edge texels inside it
    ok('none: outside the copy, transparent', near(imageAtJS(slot({ wrapU: 'none' }), img, u(1.01)), [0, 0, 0, 0]))
    ok('none: inside it, at the edge, the edge texel clamped (no wrap into the other side)',
        near(imageAtJS(slot({ wrapU: 'none' }), img, u(0.999)), texel(3, 0, true), 1e-12))
    // the two axes are independent
    const s = slot({ wrapU: 'none', wrapV: 'repeat' })
    ok('wrap per axis: v repeats where u does not', imageAtJS(s, img, [0.5, 3.7])[3] === 1 && imageAtJS(s, img, [1.5, 0.5])[3] === 0)
    ok('no image (width 0): transparent', near(imageAtJS(slotMatrix(SLOT_DEFAULTS, null), img, [0.5, 0.5]), [0, 0, 0, 0]))
    ok('a NaN position: transparent, not a texel', near(imageAtJS(slot({}), img, [NaN, 0.5]), [0, 0, 0, 0]))
}

// ---- the picture's placement: size, offset, turn (planar, seen from +z)
{
    const s = slot({ size: { x: 40, y: 30 }, offset: { x: 10, y: -5 } })
    const m = imageMappedJS(s, [10, -5, 0], [0, 0, 1])
    ok('planar: the offset is where the picture\'s centre is', near(m, [0.5, 0.5, 1]), m)
    const c = imageMappedJS(s, [10 + 20, -5 + 15, 0], [0, 0, 1])
    ok('planar: half a size from the centre is the top right corner', near(c, [1, 1, 1]), c)
    const r = slot({ size: { x: 40, y: 40 }, turn: 90 })
    const t = imageMappedJS(r, [0, 20, 0], [0, 0, 1])      // turned 90 degrees anticlockwise: its right edge points up
    ok('a turn of 90 degrees: the picture\'s +x along the frame\'s +y', near(t, [1, 0.5, 1], 1e-12), t)
}

// ---- which faces a planar picture is on
{
    const at = (faces, n) => imageMappedJS(slot({ faces }), [0, 0, 0], n)[2]
    ok('planar, front: on the face towards +z', at('front', [0, 0, 1]) === 1)
    ok('planar, front: not on the back', at('front', [0, 0, -1]) === 0)
    ok('planar, front: not on a side', at('front', [1, 0, 0]) === 0)
    ok('planar, both: front and back, not a side', at('both', [0, 0, -1]) === 1 && at('both', [0, 1, 0]) === 0)
    ok('planar, all: every face, a side too', at('all', [0, 1, 0]) === 1)
    ok('planar, front: off the front, the sample is transparent', near(imageSampleJS(slot({}), img, [0, 0, 0], [1, 0, 0]), [0, 0, 0, 0]))
    // seen from behind it is the same picture mirrored: the frame's +x is the viewer's left
    const front = imageMappedJS(slot({ faces: 'both' }), [10, 0, 0], [0, 0, 1]), back = imageMappedJS(slot({ faces: 'both' }), [10, 0, 0], [0, 0, -1])
    ok('planar, both: the back is the front seen through (a slide from behind)', near(front, back))
}

// ---- the box: each face the right way round from outside, z up on the sides
{
    const s = slot({ projection: 'box', size: { x: 2, y: 2 } })
    // a viewer outside each face, looking at it with z up (or +y up for the top and bottom): their right is u+, up v+
    const cases = [
        ['+x', [1, 0, 0], [0, 1, 0], [0, 0, 1]],     // face normal, viewer's right, viewer's up
        ['-x', [-1, 0, 0], [0, -1, 0], [0, 0, 1]],
        ['+y', [0, 1, 0], [-1, 0, 0], [0, 0, 1]],
        ['-y', [0, -1, 0], [1, 0, 0], [0, 0, 1]],
        ['+z', [0, 0, 1], [1, 0, 0], [0, 1, 0]],
        ['-z', [0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ]
    for (const [name, n, right, up] of cases) {
        const p = n.map((c, k) => c + 0.5 * right[k] + 0.5 * up[k])
        const m = imageMappedJS(s, p, n)
        ok(`box ${name}: right and up of the viewer outside are the picture's +u and +v`, near(m, [0.75, 0.75, 1], 1e-12), m)
        // and the right-hand rule: right x up points out of the face, so the picture is not mirrored
        const cross = [right[1] * up[2] - right[2] * up[1], right[2] * up[0] - right[0] * up[2], right[0] * up[1] - right[1] * up[0]]
        ok(`box ${name}: not mirrored (right x up is the outward normal)`, near(cross, n))
    }
}

// ---- triplanar: the weights sum to 1, a face-on normal is that face's box lookup alone
{
    const s = slot({ projection: 'triplanar', size: { x: 3, y: 3 }, sharpness: 4 })
    const b = slot({ projection: 'box', size: { x: 3, y: 3 } })
    const q = [0.3, -0.8, 1.1]
    ok('triplanar: face-on, the box\'s lookup', near(imageSampleJS(s, img, q, [0, 0, 1]), imageSampleJS(b, img, q, [0, 0, 1]), 1e-12))
    // a white image: whatever the normal, the mix of three whites is white (the weights sum to 1)
    const white = { width: 2, height: 2, pixels: new Uint8Array(16).fill(255) }
    let worst = 0
    for (let k = 0; k < 50; k++) {
        const n = [Math.sin(k), Math.cos(3 * k), Math.sin(7 * k + 1)]
        const l = Math.hypot(...n), nn = n.map(c => c / l)
        const c = imageSampleJS(slotMatrix({ ...SLOT_DEFAULTS, projection: 'triplanar' }, { x: 0, y: 0, w: 2, h: 2 }), white, [k, -k, 2 * k], nn)
        worst = Math.max(worst, ...c.map(v => Math.abs(v - 1)))
    }
    ok('triplanar: the three weights sum to 1 (a white picture reads 1 at any normal)', worst < 1e-12, worst)
}

// ---- the cylinder: u is the distance round the axis at the point's own radius, in mm; v along z
{
    const s = slot({ projection: 'cylindrical', size: { x: 50, y: 20 } })
    const r = 30, quarter = Math.PI / 2 * r
    const a = imageMappedJS(s, [r, 0, 0], [1, 0, 0]), b = imageMappedJS(s, [0, r, 4], [0, 1, 0])
    ok('cylindrical: a quarter turn on is a quarter circumference along u (mm)', Math.abs((b[0] - a[0]) * 50 - quarter) < 1e-9, `${(b[0] - a[0]) * 50} vs ${quarter}`)
    ok('cylindrical: v is height in mm', Math.abs((b[1] - a[1]) * 20 - 4) < 1e-12)
    ok('cylindrical: at +x the picture\'s centre', near(a, [0.5, 0.5, 1]))
}

// ---- the sphere: one copy over it, longitude and latitude
{
    const s = slot({ projection: 'spherical' })
    const eq = imageMappedJS(s, [5, 0, 0], [1, 0, 0]), np = imageMappedJS(s, [0, 0, 5], [0, 0, 1]), sp = imageMappedJS(s, [0, 0, -5], [0, 0, -1])
    ok('spherical: on the equator at +x, the centre', near(eq, [0.5, 0.5, 1], 1e-12), eq)
    ok('spherical: the north pole the top edge, the south the bottom', Math.abs(np[1] - 1) < 1e-12 && Math.abs(sp[1]) < 1e-12, `${np} ${sp}`)
    const w = imageMappedJS(s, [0, 5, 0], [0, 1, 0])
    ok('spherical: a quarter of the way round, a quarter of the picture on', Math.abs(w[0] - 0.75) < 1e-12, w)
    ok('spherical: the size does not change it (one copy the whole sphere)',
        near(imageMappedJS(slot({ projection: 'spherical', size: { x: 7, y: 900 } }), [0, 5, 0], [0, 1, 0]), w, 1e-12))
}

// ---- the slot's packing
{
    const f = slotFlags({ wrapU: 'none', wrapV: 'mirror', filter: 'pixels', faces: 'all', colour: false })
    ok('flags: wrap u, wrap v, filter, faces, colour, each where it goes', f === (3 | 1 << 2 | 1 << 4 | 2 << 5))
    ok('flags: colour the top bit', slotFlags(SLOT_DEFAULTS) === 128)
    const m = slotMatrix({ ...SLOT_DEFAULTS, turn: 30, size: { x: 5, y: 6 }, offset: { x: 1, y: 2 } }, { x: 7, y: 8, w: 9, h: 10 })
    ok('the matrix: rectangle, size and offset, turn, projection, flags, sharpness', m.length === 16
        && near(m.slice(0, 8), [7, 8, 9, 10, 5, 6, 1, 2]) && near(m.slice(8, 10), [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)], 1e-15)
        && m[10] === 0 && m[11] === 128 && m[12] === 4)
}

// ---- the atlas
{
    const list = [{ key: 'b', width: 300, height: 200 }, { key: 'a', width: 300, height: 200 }, { key: 'c', width: 1000, height: 50 }, { key: 'd', width: 64, height: 400 }]
    const A = packImages(list), B = packImages([...list].reverse())
    ok('atlas: the same layout whatever the order asked in', JSON.stringify([...A.rects]) === JSON.stringify([...B.rects]))
    const rs = [...A.rects.values()]
    let overlap = false
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const p = rs[i], q = rs[j]
        if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) overlap = true
    }
    ok('atlas: no two images overlap', !overlap)
    ok('atlas: every image inside it, at its own size', rs.every(r => r.x >= 0 && r.y >= 0 && r.x + r.w <= A.width && r.y + r.h <= A.height)
        && list.every(i => A.rects.get(i.key).w === i.width && A.rects.get(i.key).h === i.height))
    ok('atlas: none, a 1 x 1 texture', packImages([]).width === 1 && packImages([]).rects.size === 0)
    let threw = null
    try { packImages([{ key: 'x', width: ATLAS_MAX + 1, height: 10 }]) } catch (e) { threw = e.message }
    ok('atlas: an image wider than a texture can be refused, saying so', /do not fit/.test(threw ?? ''), threw)
    threw = null
    try { packImages(Array.from({ length: 5 }, (_, k) => ({ key: `k${k}`, width: 4096, height: 4096 }))) } catch (e) { threw = e.message }
    ok('atlas: five 4096-square images refused (they need 8192 x 12288)', /do not fit/.test(threw ?? ''), threw)
}

// ---- the texel read: each kernel's own (header: THE TEXEL READ IS EACH KERNEL'S OWN)
{
    const body = `${IMAGES_WGSL}\nfn getMaterial2(x: f32) -> f32 { return sample(mat4x4<f32>()).x; }\nfn SDF(x: f32) -> f32 { return x; }\n`
    ok('reaches: a main that asks for a material reaches the texel read', reaches(body, 'let a = getMaterial2(1.0);'))
    ok('reaches: one that asks for the distance alone does not', !reaches(body, 'let a = SDF(1.0);'))
    const scene = { resources: { [IMAGE_RESOURCE]: 'texture_2d<f32>' } }
    ok('withImages: the atlas read where main reaches it', withImages(scene, body, 'let a = getMaterial2(1.0);').includes(`textureLoad(${IMAGE_RESOURCE}`))
    const stub = withImages(scene, body, 'let a = SDF(1.0);')
    ok('withImages: a stub naming no texture where it does not', /fn imageTexel/.test(stub) && !new RegExp(`\\b${IMAGE_RESOURCE}\\b`).test(stub))
    ok('withImages: a scene with no image, its text untouched', withImages({ resources: {} }, 'abc', 'x') === 'abc' && withImages(null, 'abc', 'x') === 'abc')
}

// ---- A PICTURE AS A HEIGHT (heightAt, 0.84.0): the B-spline, its bound against brute force, the edges, 16 bits
{
    // a picture of random greys, opaque, and its entry as the builder makes it (its heights' bound from its pixels)
    const mk = (W, H, seed, bits = 8) => {
        let r = seed
        const rnd = () => { r = (r * 1103515245 + 12345) >>> 0; return r >>> 16 }
        if (bits === 16) {
            const g = new Uint16Array(W * H).map(() => rnd())
            const px = pack16(g, null, W, H)
            return { img: { width: W, height: H, pixels: px }, entry: { width: W, height: H, bits: 16, heights: heightStats({ width: W, height: H, pixels: px }, { bits: 16 }) }, g }
        }
        const px = new Uint8Array(W * H * 4)
        for (let i = 0; i < W * H; i++) { const v = rnd() & 255; px.set([v, (v * 3) & 255, 255 - v, 255], 4 * i) }
        return { img: { width: W, height: H, pixels: px }, entry: { width: W, height: H, heights: heightStats({ width: W, height: H, pixels: px }) } }
    }
    const P = mk(9, 7, 21)
    const rect = { x: 0, y: 0, w: 9, h: 7 }
    // a picture of one grey: that grey everywhere, a bound of 0 inside it
    const flat = { width: 3, height: 3, pixels: new Uint8Array(36).fill(200) }
    for (let i = 3; i < 36; i += 4) flat.pixels[i] = 255
    const fe = { width: 3, height: 3, heights: heightStats(flat) }
    const sf = slotMatrix({ ...SLOT_DEFAULTS, colour: false, wrapU: 'clamp', wrapV: 'clamp' }, { x: 0, y: 0, w: 3, h: 3 }, fe)
    ok('a picture of one grey: its height that grey (luminance, as data) wherever read, and its bound 0',
        Math.abs(heightAtJS(sf, flat, [13, -7, 0])[0] - 200 / 255) < 1e-12 && sf[13] < 1e-8 && heightAtJS(sf, flat, [0, 0, 0])[1] === sf[13])
    // a ramp across: the cubic B-spline reproduces a straight line exactly, away from the edges
    const ramp = { width: 8, height: 2, pixels: new Uint8Array(64) }
    for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) ramp.pixels.set([x * 30, x * 30, x * 30, 255], 4 * (y * 8 + x))
    // clamped across: repeated, its seam (the last texel against the first, 210 levels) would be the steepest step
    const sr = slotMatrix({ ...SLOT_DEFAULTS, colour: false, wrapU: 'clamp', size: { x: 80, y: 20 } }, { x: 0, y: 0, w: 8, h: 2 }, { width: 8, height: 2, heights: heightStats(ramp) })
    const hr = x => heightAtJS(sr, ramp, [x, 0, 0])[0]
    ok('a ramp read smooth: a straight line between its texels (the B-spline holds a line)', Math.abs((hr(-5) + hr(5)) / 2 - hr(0)) < 1e-12 && Math.abs(hr(5) - hr(0) - 0.5 * 30 / 255) < 1e-12)
    ok('...its bound the ramp\'s own slope: 30 levels a texel, 10 mm a texel', Math.abs(sr[13] - 30 / 255 / 10) < 1e-6, sr[13])
    const srep = slotMatrix({ ...SLOT_DEFAULTS, colour: false, size: { x: 80, y: 20 } }, { x: 0, y: 0, w: 8, h: 2 }, { width: 8, height: 2, heights: heightStats(ramp) })
    ok('...repeated, its seam the steepest step: 210 levels a texel', Math.abs(srep[13] - 210 / 255 / 10) < 1e-6, srep[13])
    // THE BOUND: never below the steepest slope brute force finds, at every wrap, a turn, an odd size; never far above it
    const fd = (s, img, q, e) => Math.hypot((heightAtJS(s, img, [q[0] + e, q[1], 0])[0] - heightAtJS(s, img, [q[0] - e, q[1], 0])[0]) / (2 * e),
                                           (heightAtJS(s, img, [q[0], q[1] + e, 0])[0] - heightAtJS(s, img, [q[0], q[1] - e, 0])[0]) / (2 * e))
    let seed = 5
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
    for (const wrapU of ['repeat', 'mirror', 'clamp', 'none']) for (const colour of [true, false]) {
        const slot = { ...SLOT_DEFAULTS, wrapU, wrapV: wrapU === 'none' ? 'repeat' : 'none', colour, size: { x: 37, y: 23 }, turn: 33, offset: { x: 3, y: -2 } }
        const sm = slotMatrix(slot, rect, P.entry)
        let worst = 0
        for (let k = 0; k < 4000; k++) worst = Math.max(worst, fd(sm, P.img, [120 * rnd() - 60, 120 * rnd() - 60, 0], 1e-4))
        ok(`the bound (${wrapU} across, ${slot.wrapV} up, ${colour ? 'colour' : 'data'}): never below the steepest slope found, nor more than three times it`,
            worst <= sm[13] * (1 + 1e-6) && worst > sm[13] / 3, `found ${worst}, bound ${sm[13]}`)
    }
    // wrap none fades to 0 past the copy: no step at its edge, and 0 two texels past it
    const sn = slotMatrix({ ...SLOT_DEFAULTS, wrapU: 'none', wrapV: 'none', size: { x: 9, y: 7 } }, rect, P.entry)
    const edge = heightAtJS(sn, P.img, [4.5 - 1e-6, 0, 0])[0], past = heightAtJS(sn, P.img, [4.5 + 1e-6, 0, 0])[0]
    ok('none: no step at the copy\'s edge (the height continuous across it)', Math.abs(edge - past) < 1e-5, `${edge} ${past}`)
    ok('...and 0 two texels past it', heightAtJS(sn, P.img, [4.5 + 2.01, 0, 0])[0] === 0)
    ok('repeat: no step at the seam either', Math.abs(heightAtJS(sm0(), P.img, [4.5 - 1e-6, 0.3, 0])[0] - heightAtJS(sm0(), P.img, [4.5 + 1e-6, 0.3, 0])[0]) < 1e-5)
    function sm0() { return slotMatrix({ ...SLOT_DEFAULTS, size: { x: 9, y: 7 } }, rect, P.entry) }
    // heights never worked out (an entry from before them): the bound 0, read flat by the relief (its code multiplies)
    ok('an entry with no heights: a bound of 0', heightSteep(SLOT_DEFAULTS, { width: 9, height: 7 }) === 0)
    ok('no picture: (0, 0)', heightAtJS(slotMatrix(SLOT_DEFAULTS, null, P.entry), P.img, [0, 0, 0]).every(v => v === 0))
    // 16 BITS: a level between two 8-bit ones read back as itself, its two bytes put together
    const D = mk(5, 4, 9, 16)
    const sd = slotMatrix({ ...SLOT_DEFAULTS, colour: false, filter: 'pixels', size: { x: 5, y: 4 } }, { x: 0, y: 0, w: 5, h: 4 }, D.entry)
    ok('16 bits: the slot says so (flags bit 8)', (sd[11] & 256) === 256)
    const at = (x, y) => imageAtJS(sd, D.img, [(x + 0.5) / 5, 1 - (y + 0.5) / 4])[0]
    let exact = true
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) if (Math.abs(at(x, y) - D.g[y * 5 + x] / 65535) > 1e-12) exact = false
    ok('16 bits: every texel its 16-bit level exactly, through the colour lookup too', exact)
    const s16 = slotMatrix({ ...SLOT_DEFAULTS, colour: false, size: { x: 5, y: 4 } }, { x: 0, y: 0, w: 5, h: 4 }, D.entry)
    let w16 = 0
    for (let k = 0; k < 3000; k++) w16 = Math.max(w16, fd(s16, D.img, [40 * rnd() - 20, 40 * rnd() - 20, 0], 1e-4))
    ok('16 bits: the bound holds', w16 <= s16[13] * (1 + 1e-6) && w16 > s16[13] / 3, `${w16} ${s16[13]}`)
    ok('the bound in the matrix: its word 13, and moving the size moves it (no compile: a live value)',
        Math.abs(slotMatrix({ ...SLOT_DEFAULTS, size: { x: 18, y: 7 } }, rect, P.entry)[13] - heightSteep({ ...SLOT_DEFAULTS, size: { x: 18, y: 7 } }, P.entry)) < 1e-15)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
