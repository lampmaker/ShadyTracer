//======================================================================================================================
// RAY PATHS -- the recorded rays of an optics trace, drawn as lines over the picture.
//
// The shade kernel records, for the first optPathRays rays, a vertex (position, weight) at the
// source and at every interaction, and a last one optEscLen along an escaping ray (optics/kernels.js).
// Here each consecutive pair becomes one line, pulled straight out of that buffer by
// instance_index -- no vertex buffers, nothing copied -- and drawn with additive blending on top of
// what the display pass just drew (R.overlays in raytrace_main.js), so a bright bundle is a bright
// line and a single stray ray is faint.
//
// PROJECTED AS THE RAY KERNEL PROJECTS, not through a matrix: the same basis from invView's columns
// and the two diagonal entries of invProjection that genrays.js projectPoint reads, so a path lands
// on the pixels the traced surface did. A segment is cut at the near plane first (clipToView's rule)
// or a ray running past the camera would be drawn across the whole screen.
//
// COLOUR: 0 by weight (what is left of the ray along the leg -- its END vertex's weight, log scale,
// turbo), 1 by step (interaction number),
// 2 plain, 3 the light's own colour -- the hue the ray carries along the leg (recorded at the leg's
// END vertex, which is what arrived there: the source's hue times any coloured glass passed on the
// way), scaled so its brightest channel is 1, at the plain mode's brightness. 4 the ray's flux PER
// CHANNEL, LINEARLY: the hue (luminance 1) times the weight (a luminance) is beta x radiance itself,
// so where rays overlap the additive blend sums to the RGB flux through there. Until 0.44.1 it was
// the max-normalised hue times the luminance -- RGB x Y / max(RGB), right for a white ray only: a
// dispersed ray (one wavelength, core/spectral.js) drew at 0.72 of its flux when green, 0.21 when
// red, 0.07 when blue, and a prism's white bundle summed to (0.35, 0.71, 0.14) -- its reflections,
// where every wavelength overlaps, came out green (the user, 2026-10-09). Mode 3 is every ray at full strength whatever it
// has lost; mode 0 has the loss but on a log scale and not in the light's colour. Every ray leaves
// its light at weight 1 (a light's flux is in how many rays it sends, not how bright each is) --
// a ray-set ray at its file's weight -- and clear glass does not dim one (reflect or refract is a
// pick), so what dims a ray here is absorption and tinted glass.
//
// TWO LIMITS, both applied here so moving them only redraws: the number of legs shown per ray (the
// page's step slider when it shows less than was traced) and an OPTICAL PATH LENGTH each ray is cut
// at -- the old tool's slider, which shows the light as a front moving through the system.
//======================================================================================================================
import { O_PATHS, VERT_WORDS } from './kernels.js'
import { engineCamera } from '../core/units.js'

const CODE = /*wgsl*/`
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) col: vec4<f32> };

fn turboC(t_in: f32) -> vec3<f32> {
    let x = clamp(t_in, 0.0, 1.0);
    let v4 = vec4<f32>(1.0, x, x * x, x * x * x);
    let v2 = v4.zw * v4.z;
    return vec3<f32>(
        dot(v4, vec4<f32>(0.13572138, 4.61539260, -42.66032258, 132.13108234)) + dot(v2, vec2<f32>(-152.94239396, 59.28637943)),
        dot(v4, vec4<f32>(0.09140261, 2.19418839, 4.84296658, -14.18503333)) + dot(v2, vec2<f32>(4.27729857, 2.82956604)),
        dot(v4, vec4<f32>(0.10667330, 12.64194608, -60.58204836, 110.36276771)) + dot(v2, vec2<f32>(-89.90310912, 27.34824973)));
}
// position and weight of vertex k of ray id; its optical path length separately
fn vbase(id: u32, k: u32) -> u32 { return ${O_PATHS}u + UB.rays + (id * UB.verts + k) * ${VERT_WORDS}u; }
fn vert(id: u32, k: u32) -> vec4<f32> {
    let b = vbase(id, k);
    return vec4<f32>(bitcast<f32>(optData[b]), bitcast<f32>(optData[b + 1u]),
                     bitcast<f32>(optData[b + 2u]), bitcast<f32>(optData[b + 3u]));
}
fn vopl(id: u32, k: u32) -> f32 { return bitcast<f32>(optData[vbase(id, k) + 4u]); }
fn vhue(id: u32, k: u32) -> vec3<f32> {
    let b = vbase(id, k);
    return vec3<f32>(bitcast<f32>(optData[b + 5u]), bitcast<f32>(optData[b + 6u]), bitcast<f32>(optData[b + 7u]));
}
// depth ahead of the camera, and the kernel's screen position -- genrays.js projectPoint
fn depthOf(p: vec3<f32>) -> f32 { return -dot(p - UB.camPos.xyz, UB.invView[2].xyz); }
fn screen(p: vec3<f32>) -> vec2<f32> {
    let d = p - UB.camPos.xyz;
    let a = dot(d, UB.invView[0].xyz);
    let b = dot(d, UB.invView[1].xyz);
    if (UB.camtype == 1u) { return vec2<f32>(a / UB.fx, b / UB.fy); }
    let z = depthOf(p);
    return vec2<f32>(a / (z * UB.fx), b / (z * UB.fy));
}

@vertex fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
    var o: VOut;
    o.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);          // off screen: a segment that does not exist
    o.col = vec4<f32>(0.0);
    let segs = max(UB.verts, 2u) - 1u;
    let id = ii / segs;
    let k = ii % segs;
    if (id >= UB.rays) { return o; }
    let n = optData[${O_PATHS}u + id];
    if (k + 1u >= n) { return o; }
    // THE TWO SLIDERS, both at draw time so moving them only redraws: segment k is the (k+1)-th
    // leg, shown while k < showSteps; and each ray is cut where its optical path length reaches
    // maxOpl -- linear within a leg, since n is constant along one
    if (k >= UB.showSteps) { return o; }
    var pa = vert(id, k);
    var pb = vert(id, k + 1u);
    /* WHAT IS LEFT ALONG THIS LEG is the weight recorded at its END: a vertex records what ARRIVED
       there. The start vertex's weight is from before that surface took its share, so a leg leaving
       a 50% absorber drew at full strength and the drop showed one leg late. Read before the
       clipping below, which interpolates the vertices. */
    let wLeg = pb.w;
    let la = vopl(id, k);
    let lb = vopl(id, k + 1u);
    if (la >= UB.maxOpl) { return o; }
    if (lb > UB.maxOpl) { pb = vec4<f32>(mix(pa.xyz, pb.xyz, (UB.maxOpl - la) / max(lb - la, 1e-20)), pb.w); }
    // cut at the near plane (perspective only: an orthographic camera sees behind nothing): a thousandth of a scene unit
    let near = UB.near;
    let da = depthOf(pa.xyz);
    let db = depthOf(pb.xyz);
    if (UB.camtype == 0u) {
        if (da < near && db < near) { return o; }
        if (da < near) { pa = mix(pa, pb, (near - da) / (db - da)); }
        if (db < near) { pb = mix(pa, pb, (near - da) / (db - da)); }
    }
    let pp = select(pa, pb, vi == 1u);
    o.pos = vec4<f32>(screen(pp.xyz), 0.5, 1.0);
    var c = vec3<f32>(1.0, 0.85, 0.3);
    if (UB.colorMode == 0u) {
        // what is left of the ray on this leg: 1 at the source, log scale over four decades
        c = turboC(1.0 + log2(max(wLeg, 1e-6)) / 13.3);
    } else if (UB.colorMode == 1u) {
        c = turboC(f32(k) / max(f32(segs), 1.0));
    } else if (UB.colorMode >= 3u) {
        let h = max(vhue(id, k + 1u), vec3<f32>(0.0));
        c = h / max(max(h.x, max(h.y, h.z)), 1e-6);
        // 4: the flux the ray carries, per channel: hue (luminance 1) x weight (its luminance) is its
        // RGB -- NOT the max-normalised hue above times the luminance, which weighed a blue ray at a
        // tenth of its flux (header). The weight can go below zero: a light outside the Rec.709 gamut
        // keeps a negative channel (optics/README.md, Colour) and a coloured material scales
        // channels. max keeps such a ray from subtracting light out of the additive blend.
        if (UB.colorMode == 4u) { c = h * max(wLeg, 0.0); }
    }
    o.col = vec4<f32>(c * UB.brightness, 1.0);
    return o;
}
@fragment fn fs_main(v: VOut) -> @location(0) vec4<f32> { return v.col; }
`

export function makePathDrawer(WG, RT) {
    const d = {
        on: false,
        // showSteps: legs drawn per ray; maxOpl: optical path length each ray is drawn up to
        style: { colorMode: 0, brightness: 0.02, showSteps: 1e9, maxOpl: Infinity },
        pipe: null, data: null,
    }
    const ensure = () => d.pipe || (d.pipe = WG.makeDraw({
        code: CODE,
        uniforms: { camPos: 'vec4<f32>', invView: 'mat4x4<f32>', fx: 'f32', fy: 'f32', camtype: 'u32',
                    rays: 'u32', verts: 'u32', colorMode: 'u32', brightness: 'f32',
                    showSteps: 'u32', maxOpl: 'f32', near: 'f32' },
        resources: { optData: 'array<u32>' },
        readOnly: ['optData'],
        topology: 'line-list',
        blend: 'additive',
        count: 2,
    }))
    d.build = ensure                         // check-shaders compiles it through this
    d.bind = buf => { d.data = buf; if (d.pipe) d.pipe.resources = { optData: buf.b } }
    d.draw = (target, { rays, verts }) => {
        const p = ensure()
        if (!d.data) return
        p.resources = { optData: d.data.b }
        /* THE VERTICES ARE THE TRACE'S, IN METRES (the engine's unit since 0.36.0), so the camera they are drawn by is
           converted as the kernels' is (core/units.js engineCamera), and the page's lengths -- the path-length slider,
           in the scene's unit -- with it */
        const camtype = RT.cam.get().camtype ?? 0, u = +RT.uniformBag?.()?.sceneUnit || 1
        const CU = engineCamera(RT.cam.getUniforms(), camtype, u)
        p.uniforms = {
            camPos: [CU.camPos[0], CU.camPos[1], CU.camPos[2], 0], invView: CU.invView,
            fx: CU.invProjection[0], fy: CU.invProjection[5], camtype,
            rays, verts, colorMode: d.style.colorMode | 0, brightness: d.style.brightness,
            showSteps: Math.min(d.style.showSteps, 4294967295) >>> 0,
            maxOpl: Number.isFinite(d.style.maxOpl) ? d.style.maxOpl * u : 3.0e38,
            near: 1e-3 * u,
        }
        p.instances = rays * Math.max(1, verts - 1)
        p.drawTo(target, 'load')
    }
    return d
}
