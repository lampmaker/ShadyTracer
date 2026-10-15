//======================================================================================================================
// THE PHOTON MAP (0.60.0) -- light -> glass -> a surface -> glass -> eye, seen through the glass.
//
// WHY. The user's picture (2026-10-15, the full renderer, an aperture): a lamp, a glass slab standing on a white floor
// before a white wall, and through the slab -- black, with white specks. The floor and wall behind the slab, lit by the
// lamp through the slab and seen through it, are the path class
//     light -> delta+ -> D -> delta+ -> eye        (D a diffuse or glossy surface, delta a mirror or clear glass)
// and nothing here drew it but by chance. Light sampling cannot aim through glass (a shadow ray stops at any surface);
// a photon's connection is a straight line to the camera, which the slab blocks; the camera's own paths would have to
// guess the one direction the slab maps onto the lamp; the lens's photons (0.43.0) counted it only when one happened to
// cross the lens disc -- the specks; the manifold connection (0.44.0) only for D inside the glass with ONE refraction
// to the eye, not a floor in air behind a slab's two faces. In the Optics view not even that. The user chose photon
// mapping, roadmap/PLAN.md's open item since the lens: one mechanism for every chain of glass and mirrors, at the price
// of a blur that shrinks as samples come in. Seen on their card and liked (2026-10-15), so in 0.61.0 it is on by default
// and the two before it went (materials_pbr.js, THE CLASS THE PHOTON MAP OWNS, says what they were).
//
// WHAT IT IS. Probabilistic progressive photon mapping (Knaus & Zwicker 2011, "Progressive photon mapping: a
// probabilistic approach"). Every sample traces its photons first, and every one that has passed a delta event and
// lands on a surface with an evaluable lobe is STORED there: where, its power, where it came from, the surface's
// normal. Then the sample's camera rays: one that has seen only delta events since the eye GATHERS where it lands --
//     L(x -> v) = sum over stored photons within r of  f(x; l_p -> v) Phi_p / (pi r^2)
// over the evaluable lobes (lobesEval from LT_MIN_ALPHA, ltConnect's: the lobes a connection evaluates), times its
// throughput. That is one photon-mapping estimate per sample, and the picture's own true mean averages them; the radius
// shrinks from sample to sample, r_k^2 = r_1^2 prod_{i<k} (i + alpha) / (i + 1), so the average converges to the right
// answer with no per-pixel statistics kept (the paper's point). Biased in any one sample (a blur of radius r_k),
// consistent in the limit.
//
// WHICH PATHS IT OWNS: the class named for the lens that owned it first (materials_pbr.js lensStep, lensOwned). A photon
// is stored while its lens field is 0 with TAG_PASSED (delta events only, at least one); a camera ray gathers while its
// field is 1 (the same from the eye). The camera's path then leaves the class -- the light it reaches through D and
// delta events again. Per source: the camera hands over the sun's, the emitters' and the lights' part only while their
// photons run (UB.lt, ltEmit, ltLights), and the map holds exactly the photons that ran.
// AND A LIGHT NO CAMERA PATH CAN MEET (0.61.0): a collimated beam, or a light with no face (Ray.ltMis < 0,
// optics/kernels.js). Its light reaches the picture only through its photons -- ltConnect evaluates every lobe for
// them, at every surface, in air -- so a surface it lights, seen through glass, was nobody's. Its photons are stored at
// every surface they land on, whatever came before, and gathered through every lobe (the record's flag, SPPM_ALL):
// nothing else counts any path that ends at such a light.
// THE PATH'S LENGTH: a merged path is counted only if the camera alone could have made it, b_c + b_p - 1 <= maxbounce
// (each side's surfaces, D counted on both): ltConnect's cap, for a connection made in the middle of a path.
//
// WHY PHOTONS FIRST, THEN CAMERA RAYS, IN EVERY SAMPLE (raytrace_main.js R.trace; photons.js planBatches's groups). The
// wavefront runs a sample's camera rays and photons in the same batches, so a camera ray can land on D before the
// photons have. A map one sample late was the first plan; it fails on what the two sides read that changes between
// samples -- the emitter list (emitCovers) above all -- so a sample's camera rays would hand over light the map's
// photons were drawn without. In one sample nothing moves between the two. What it costs: a second wavefront chain a
// sample while the map is on (inferred: its iterations' fixed cost; not measured).
//
// THE GRID: a hash table of linked lists, built as photons are stored (tinywebgpu has no sort or prefix sum): a photon
// takes the next record (atomicAdd on the count) and puts itself at the head of its cell's list (atomicExchange). The
// cell is 2r, so a gather's sphere meets the cell it is in and one neighbour on each axis: eight lists. A list may hold
// another cell's photons where two hash alike; a photon is counted only from its own cell's visit, so none twice.
//
// IDLE (0.61.0, on by default): a gather marks the map's header (SPPM_LOOKED); a sample in which no camera ray looked
// through glass or a mirror at an evaluable surface makes the host run the traces after it without the map, one chain
// as before, until a reset or a probe every SPPM_PROBE traces (raytrace_main.js, THE PHOTON MAP THIS TRACE).
//
// Pure functions for the JS mirror (test/sppm.test.mjs), and the WGSL: SPPM_SHARED_WGSL in every kernel the BSDF is in
// (materials_pbr.js: lensOwned reads it), SPPM_WGSL in wavefront.js prog_sppm alone.
//======================================================================================================================

/** The hash table's lists, a power of two. 2^20 heads is 4 MiB: at the default two million photons, two a list. */
export const SPPM_HEADS = 1 << 20
/** The words before the heads: the photons stored (may run past the capacity: the rest are the overflow), the gathers
 *  cut short at SPPM_VISIT, whether any camera ray gathered (SPPM_LOOKED: the idle skip's), one unused. */
export const SPPM_HEADER = 4
export const SPPM_LOOKED = 2
/** A photon's record, in words: its point (3, f32), its power (3, f32), the direction it came from and its surface's
 *  normal (octahedral, 2 x 16-bit snorm each), the next in its list (index + 1, 0 none), its surfaces so far -- with
 *  SPPM_ALL, bit 31, for a photon of a light no camera path can meet: gathered through every lobe. */
export const SPPM_REC = 10
export const SPPM_ALL = 0x80000000
/** While idle, the map runs again every this many traces to look (raytrace_main.js). */
export const SPPM_PROBE = 16
/** Photons a gather looks at, at most: a bound on a thread's time. One that stops there is counted (the stats). */
export const SPPM_VISIT = 512
/** A photon whose surface's normal is more than about 25 degrees off the gather's is another surface: not counted. */
export const SPPM_NORMAL_DOT = 0.9
/** The radius's shrink (the paper's alpha): 2/3, its recommendation. */
export const SPPM_ALPHA = 2 / 3
/** The capacity's default, in millions of photons (the setting sppmCapacity): 40 bytes each, 80 MB at 2. */
export const SPPM_CAPACITY_DEFAULT = 2

/** r_k for the k-th sample since the picture's reset (k from 1): r_1 times the schedule. */
export function sppmRadius(r1, k, alpha = SPPM_ALPHA) {
    let s = 1
    for (let i = 1; i < Math.max(1, k | 0); i++) s *= (i + alpha) / (i + 1)
    return r1 * Math.sqrt(s)
}
/** One pixel's footprint at distance d along the axis: the image plane's height 2 fy at 1, over the rows. */
export const pixelFootprint = (d, fy, rows) => 2 * d * fy / Math.max(1, rows)

/** The cell a point is in, cells of size c. */
export const cellOf = (p, c) => p.map(v => Math.floor(v / c))
/** The cell's list (the same arithmetic as the WGSL's: 32-bit multiplies, wrapping). */
export const hashCell = (i, j, k, heads = SPPM_HEADS) =>
    ((Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791)) >>> 0) & (heads - 1)
/** The eight cells a sphere of radius c / 2 or less round p can meet: its own, and on each axis the neighbour on the
 *  side of the cell's middle p is. */
export function neighbourCells(p, c) {
    const g = p.map(v => v / c), c0 = g.map(Math.floor), s = g.map((v, a) => v - c0[a] >= 0.5 ? 1 : -1)
    const out = []
    for (let k = 0; k < 8; k++) out.push([c0[0] + (k & 1 ? s[0] : 0), c0[1] + (k & 2 ? s[1] : 0), c0[2] + (k & 4 ? s[2] : 0)])
    return out
}

/** THE MAP IN JS, as the kernel builds and reads it: store, then gather. f(l, all) is the surface's lobes from the photon's
 *  direction: the evaluable ones, or every one for a photon stored `all` (a light no camera path can meet). */
export class PhotonMap {
    constructor(cell, heads = SPPM_HEADS) {
        this.c = cell; this.H = heads
        this.head = new Int32Array(heads)              // index + 1, 0 none
        this.rec = []                                  // { p, power, l, n, b, all, next }
    }
    store(p, power, l, n, b = 1, all = false) {
        const i = this.rec.length, [x, y, z] = cellOf(p, this.c), h = hashCell(x, y, z, this.H)
        this.rec.push({ p, power, l, n, b, all, next: this.head[h] })
        this.head[h] = i + 1
    }
    /** The sum of f * power over the photons within r of x on a surface facing n, and how many were looked at. */
    gather(x, n, r, f, { maxB = Infinity, bc = 1, visit = Infinity } = {}) {
        const r2 = r * r
        let sum = [0, 0, 0], visits = 0
        for (const cell of neighbourCells(x, this.c)) {
            let q = this.head[hashCell(...cell, this.H)]
            while (q && visits < visit) {
                visits++
                const ph = this.rec[q - 1]
                const own = cellOf(ph.p, this.c)
                const d = [ph.p[0] - x[0], ph.p[1] - x[1], ph.p[2] - x[2]]
                if (own[0] === cell[0] && own[1] === cell[1] && own[2] === cell[2] && d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= r2
                    && ph.n[0] * n[0] + ph.n[1] * n[1] + ph.n[2] * n[2] >= SPPM_NORMAL_DOT && bc + ph.b <= maxB + 1) {
                    const fv = f(ph.l, ph.all)
                    sum = sum.map((s, a) => s + fv[a] * ph.power[a])
                }
                q = ph.next
            }
        }
        return { sum, visits }
    }
}

/* THE GATES, transcribed (test/sppm.gpu.mjs holds the WGSL to them). Tag bits as tracebasics.js has them. */
export const TAGS = { PHOTON: 1, PASSED: 4, PROBE: 64, OPTIC: 128, LTALL: 256, SEEK: 512, CAM_SHIFT: 12, PH_SHIFT: 14 }
/** A photon arriving at a surface, stored there? (full renderer and Draft: delta events only so far, at least one; a light
 *  no camera path can meet, ltMis < 0, always; the Optics view, every one of the lights') */
export function storesJS(tag, bounces, maxbounce, { optics = false, ltMis = 0 } = {}) {
    const T = TAGS
    if (!(tag & T.PHOTON) || (tag & T.PROBE)) return false
    const lightsPhoton = (tag & T.OPTIC) !== 0 && (tag & T.LTALL) !== 0
    if ((tag & T.OPTIC) && !(tag & T.LTALL)) return false              // the Optics page's own rays light nothing
    if (bounces + 1 > maxbounce) return false
    if (optics || (lightsPhoton && ltMis < 0)) return lightsPhoton     // every one of the lights', or the unmet light's
    return (tag & T.PASSED) !== 0 && ((tag >>> T.PH_SHIFT) & 3) === 0
}
/** ...through every lobe? A light no camera path can meet: nothing else counts its light (ltConnect, minAlpha 0). */
export const allLobesJS = (tag, ltMis) => (tag & TAGS.OPTIC) !== 0 && (tag & TAGS.LTALL) !== 0 && ltMis < 0
/** A camera ray arriving at a surface, gathering there? Delta events only since the eye, at least one. */
export function gathersJS(tag) {
    const T = TAGS
    if (tag & (T.PHOTON | T.PROBE | T.SEEK)) return false
    return ((tag >>> T.CAM_SHIFT) & 3) === 1
}

/*======================================================================================================================
  THE WGSL. UB.sppmCtl: x the map runs this sample (the host's whole decision: the setting, the kernel built, a mode it
  runs in, a perspective camera, not the illuminance view, not idle), y the capacity in photons, z and w unused.
  UB.sppmGeom: x the radius and y the cell (2r), in metres, z 1 / (pi r^2); w unused.
======================================================================================================================*/
/* WHAT EVERY KERNEL WITH THE BSDF READS (materials_pbr.js includes it): whether the map runs, and whether it owns the
   class -- the full renderer, where the camera's paths go on past D and must leave it. In Draft and Optics a
   camera path ends at D (FAST MODES), so the map adds what nothing else counts and owns nothing. */
export const SPPM_SHARED_WGSL = /*wgsl*/`
fn sppmOn() -> bool { return UB.sppmCtl.x != 0u; }
fn sppmSplit() -> bool { return sppmOn() && UB.renderMode == 0u; }
`

export const SPPM_WGSL = /*wgsl*/`
const SPPM_HEADS: u32 = ${SPPM_HEADS}u;
const SPPM_HEADER: u32 = ${SPPM_HEADER}u;
const SPPM_REC: u32 = ${SPPM_REC}u;
const SPPM_VISIT: u32 = ${SPPM_VISIT}u;
const SPPM_NORMAL_DOT: f32 = ${SPPM_NORMAL_DOT};
const SPPM_LOOKED: u32 = ${SPPM_LOOKED}u;
const SPPM_ALL: u32 = ${SPPM_ALL >>> 0}u;
// A DIRECTION IN 32 BITS, octahedral, two 16-bit snorms: the photon's incoming direction and its surface's normal
fn sppmOct(v: vec3<f32>) -> u32 {
    let a = v / (abs(v.x) + abs(v.y) + abs(v.z));
    var e = a.xy;
    if (a.z < 0.0) { e = (vec2<f32>(1.0) - abs(a.yx)) * select(vec2<f32>(-1.0), vec2<f32>(1.0), a.xy >= vec2<f32>(0.0)); }
    return pack2x16snorm(e);
}
fn sppmUnoct(w: u32) -> vec3<f32> {
    let e = unpack2x16snorm(w);
    var v = vec3<f32>(e, 1.0 - abs(e.x) - abs(e.y));
    if (v.z < 0.0) { v = vec3<f32>((vec2<f32>(1.0) - abs(v.yx)) * select(vec2<f32>(-1.0), vec2<f32>(1.0), v.xy >= vec2<f32>(0.0)), v.z); }
    return normalize(v);
}
fn sppmCellOf(p: vec3<f32>) -> vec3<i32> { return vec3<i32>(floor(p / UB.sppmGeom.y)); }
fn sppmHash(c: vec3<i32>) -> u32 {
    let h = (bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u) ^ (bitcast<u32>(c.z) * 83492791u);
    return h & (SPPM_HEADS - 1u);
}
/* A SURFACE A CONNECTION EVALUATES: a diffuse base, or gloss rough enough -- the lobes lobesEval counts from
   LT_MIN_ALPHA. Nothing to store or gather elsewhere: f is 0 there. A photon of a light no camera path can meet is
   gathered through every lobe, so for it, and for a camera ray (which cannot know whose photons it will meet), any
   roughness counts: lobesEval itself gives a mirror's delta nothing. A test before the work, never the answer. */
fn sppmEvaluable(m: Material2, all: bool) -> bool {
    return (1.0 - m.metallic) * (1.0 - m.transmission) > 0.0 || m.roughness > select(0.05, 0.0, all);
}
/* A PHOTON OF A LIGHT NO CAMERA PATH CAN MEET (Ray.ltMis < 0: collimated, or no face; optics/kernels.js): a light's */
fn sppmUnmet(r: Ray) -> bool { return (r.tag & TAG_OPTIC) != 0u && (r.tag & TAG_LTALL) != 0u && r.ltMis < 0.0; }
/* A PHOTON ARRIVING (its bounces not yet counted for this surface), STORED HERE? A picture's photon (the sun's, an
   emitter's, a light's -- never the Optics page's own rays, nor a probe) within the bounce cap; in the full renderer
   and Draft one that has passed delta events only, at least one (the lens's photon field 0, TAG_PASSED); in the Optics
   view every one of the lights' photons, since nothing else counts a light's light where a camera path ends; and in
   every mode every one of a light's no camera path can meet (sppmUnmet), for the same reason. */
fn sppmStores(r: Ray) -> bool {
    if ((r.tag & TAG_PHOTON) == 0u || (r.tag & TAG_PROBE) != 0u) { return false; }
    let optic = (r.tag & TAG_OPTIC) != 0u;
    let lights = optic && (r.tag & TAG_LTALL) != 0u;
    if (optic && !lights) { return false; }
    if (r.bounces + 1u > UB.maxbounce) { return false; }
    if (UB.renderMode == 3u || sppmUnmet(r)) { return lights; }
    return (r.tag & TAG_PASSED) != 0u && lensField(r.tag, LENS_PH_SHIFT) == 0u;
}
/* A CAMERA RAY ARRIVING, GATHERING HERE? Delta events only since the eye, at least one (its lens field 1) */
fn sppmGathers(r: Ray) -> bool {
    if ((r.tag & (TAG_PHOTON | TAG_PROBE | TAG_SEEK)) != 0u) { return false; }
    return lensField(r.tag, LENS_CAM_SHIFT) == 1u;
}
/* STORED: the next record, and the head of its cell's list. Past the capacity it is counted and dropped. */
fn sppmStore(r: Ray, nrm: vec3<f32>, power: vec3<f32>) {
    let idx = atomicAdd(&sppmHeads[0], 1u);
    if (idx >= UB.sppmCtl.y) { return; }
    let o = idx * SPPM_REC;
    sppmRecs[o] = bitcast<u32>(r.pos.x); sppmRecs[o + 1u] = bitcast<u32>(r.pos.y); sppmRecs[o + 2u] = bitcast<u32>(r.pos.z);
    sppmRecs[o + 3u] = bitcast<u32>(power.x); sppmRecs[o + 4u] = bitcast<u32>(power.y); sppmRecs[o + 5u] = bitcast<u32>(power.z);
    sppmRecs[o + 6u] = sppmOct(-r.dir);
    sppmRecs[o + 7u] = sppmOct(nrm);
    sppmRecs[o + 9u] = (r.bounces + 1u) | select(0u, SPPM_ALL, sppmUnmet(r));
    sppmRecs[o + 8u] = atomicExchange(&sppmHeads[SPPM_HEADER + sppmHash(sppmCellOf(r.pos))], idx + 1u);
}
/* GATHERED: f * power over the photons within the radius on this surface, over pi r^2. The eight lists, each photon
   only from its own cell's. ONE lobesEval, in the loop, its floor chosen per photon (every lobe for SPPM_ALL's): every
   call is a copy of the BSDF once inlined (ltConnect says why), and the loop's bound goes through noUnroll so the
   compiler does not make eight. And the header marked: a camera ray looked through glass or a mirror here (the idle
   skip's; a store, the same value from every thread, never a sum). */
fn sppmGather(r: Ray, nrm: vec3<f32>, m: Material2) -> vec3<f32> {
    atomicStore(&sppmHeads[SPPM_LOOKED], 1u);
    let rad = UB.sppmGeom.x;
    let n0 = r.n;
    let lb = makeLobes(nrm, -r.dir, m, n0 / ownMedium(m, n0), n0, false);
    let g = r.pos / UB.sppmGeom.y;
    let c0 = vec3<i32>(floor(g));
    let side = select(vec3<i32>(-1), vec3<i32>(1), g - floor(g) >= vec3<f32>(0.5));
    let bc = r.bounces + 1u;
    var sum = vec3<f32>(0.0);
    var visits = 0u;
    for (var k = 0u; k < noUnroll(8u); k++) {
        let cell = c0 + vec3<i32>(select(0, side.x, (k & 1u) != 0u), select(0, side.y, (k & 2u) != 0u), select(0, side.z, (k & 4u) != 0u));
        var q = atomicLoad(&sppmHeads[SPPM_HEADER + sppmHash(cell)]);
        loop {
            if (q == 0u || visits >= SPPM_VISIT) { break; }
            visits = visits + 1u;
            let o = (q - 1u) * SPPM_REC;
            q = sppmRecs[o + 8u];
            let p = vec3<f32>(bitcast<f32>(sppmRecs[o]), bitcast<f32>(sppmRecs[o + 1u]), bitcast<f32>(sppmRecs[o + 2u]));
            let d = p - r.pos;
            if (any(sppmCellOf(p) != cell) || dot(d, d) > rad * rad) { continue; }
            if (dot(sppmUnoct(sppmRecs[o + 7u]), nrm) < SPPM_NORMAL_DOT) { continue; }
            let b = sppmRecs[o + 9u];
            if (bc + (b & ~SPPM_ALL) > UB.maxbounce + 1u) { continue; }
            let f = lobesEval(lb, sppmUnoct(sppmRecs[o + 6u]), select(LT_MIN_ALPHA, 0.0, (b & SPPM_ALL) != 0u));
            sum += f * vec3<f32>(bitcast<f32>(sppmRecs[o + 3u]), bitcast<f32>(sppmRecs[o + 4u]), bitcast<f32>(sppmRecs[o + 5u]));
        }
    }
    if (visits >= SPPM_VISIT) { atomicAdd(&sppmHeads[1], 1u); }
    return sum * UB.sppmGeom.z;
}
`
