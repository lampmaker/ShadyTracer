//======================================================================================================================
// AN ESTIMATE OVER BATCHES: every number the optics module reports -- the totals, per object, per material, and the
// far field per bin -- as the mean over independent batches with the standard error from their spread.
//
//   const E = makeEstimate()
//   E.add(batch, far)      // one batch's reading (index.js scaled) and its far field, or null
//   E.merge(F)             // another estimate's batches into this one (F is left as it was)
//   E.results()            // { unit, rays, batches, emitted, escaped, ... } each { value, se } -- null before a batch
//   E.farField()           // { mode, nC, nG, ..., flux, se, batches, rays, emitted } -- null without a far field
//
// RUNNING, NOT A LIST. It was a list of every batch's reading, combined again after each one: right for one run of a
// few batches, and quadratic for the Optics page's Live analysis, which adds round after round for as long as nothing
// changes. Per number it keeps Welford's mean and sum of squared deviations over the batches the number appeared in.
// A batch that lacked a number -- an object none of its rays reached, which the tallies leave out -- counts as a zero
// of that batch, merged in when it is read; merging two estimates is the parallel form of the same update (Chan et
// al.). Both are exact, so the mean and error are the two-pass ones whatever the order, and a number every batch
// gave the same reads exactly that with an error of exactly zero (test/optics.test.mjs holds it to the list's form).
//
// THE FAR FIELD keeps plain sums and sums of squares per bin, as it always has: a fine grid is 260 000 bins, and two
// arrays of them are what fits. Every batch of one estimate must be of the same grid: one of another is refused.
//======================================================================================================================

/** Welford's running mean and M2, and the merge of two of them. */
const welfordAdd = (w, x) => { w.c++; const d = x - w.mean; w.mean += d / w.c; w.m2 += d * (x - w.mean) }
const welfordMerge = (a, b) => {
    if (!b.c) return a
    if (!a.c) return Object.assign(a, b)
    const c = a.c + b.c, d = b.mean - a.mean
    a.m2 += b.m2 + d * d * a.c * b.c / c
    a.mean += d * b.c / c
    a.c = c
    return a
}
const KINDS = ['objects', 'materials']
// volume: what the media absorbed between surfaces, a part of absorbed (index.js scaled; 0.37.0)
const TOTALS = ['emitted', 'escaped', 'lost', 'absorbed', 'detected', 'volume']
const farSig = f => JSON.stringify([f.mode, f.material, f.nC, f.nG, f.axis, f.c0])

export function makeEstimate() {
    let n = 0, rays = 0, unit = null, detectorHits = 0, far = null
    const stats = new Map()                                  // key -> { c, mean, m2 }
    const names = { objects: new Map(), materials: new Map() }, hits = { objects: new Map(), materials: new Map() }
    const put = (key, x) => {
        let w = stats.get(key)
        if (!w) stats.set(key, w = { c: 0, mean: 0, m2: 0 })
        welfordAdd(w, x)
    }
    /* a number as read: the batches without it are zeros, merged in -- n - c of them */
    const stat = key => {
        const w = stats.get(key) ?? { c: 0, mean: 0, m2: 0 }
        const z = welfordMerge({ ...w }, { c: n - w.c, mean: 0, m2: 0 })
        return { value: z.mean, se: n > 1 ? Math.sqrt(z.m2 / (n - 1) / n) : null }
    }
    const E = {
        get batches() { return n },
        get rays() { return rays },
        /** One batch: `r` its reading (index.js scaled: totals in the source's unit, objects and materials by index),
         *  `f` its far field -- { mode, material, nC, nG, axis, c0, flux (per bin), emitted, unit } -- or null. */
        add(r, f = null) {
            if (n && !!far !== !!f) throw new Error('[optics] an estimate takes batches all with a far field or all without')
            if (f && far && farSig(f) !== far.sig) throw new Error('[optics] a batch of another far-field grid: start a new estimate')
            n++; rays += r.rays; unit ??= r.unit; detectorHits = r.detectorHits ?? detectorHits
            for (const k of TOTALS) put(k, k === 'volume' ? r[k] ?? 0 : r[k])     // a reading from before 0.37.0 has no volume
            put('ipr', r.counts ? r.counts.interactions / r.rays : 0)
            for (const kind of KINDS) for (const o of r[kind] ?? []) {
                if (o.name && !names[kind].has(o.index)) names[kind].set(o.index, o.name)
                hits[kind].set(o.index, (hits[kind].get(o.index) ?? 0) + o.hits)
                put(`${kind}.${o.index}.incident`, o.incident)
                put(`${kind}.${o.index}.absorbed`, o.absorbed)
            }
            if (f) {
                far ??= { sig: farSig(f), mode: f.mode, material: f.material, nC: f.nC, nG: f.nG, axis: f.axis, c0: f.c0,
                          emitted: f.emitted, unit: f.unit ?? 'lm', n: 0, sum: new Float64Array(f.flux.length), sq: new Float64Array(f.flux.length) }
                for (let i = 0; i < f.flux.length; i++) { const x = f.flux[i]; far.sum[i] += x; far.sq[i] += x * x }
                far.n++; far.emitted = f.emitted
            }
            return E
        },
        /** Another estimate's batches added to this one; it is not changed. */
        merge(F) {
            const s = F._state()
            if (!s.n) return E
            if (n && !!far !== !!s.far) throw new Error('[optics] an estimate takes batches all with a far field or all without')
            if (s.far && far && s.far.sig !== far.sig) throw new Error('[optics] an estimate of another far-field grid: start a new estimate')
            for (const [k, w] of s.stats) { let a = stats.get(k); if (!a) stats.set(k, a = { c: 0, mean: 0, m2: 0 }); welfordMerge(a, { ...w }) }
            for (const kind of KINDS) {
                for (const [i, nm] of s.names[kind]) if (!names[kind].has(i)) names[kind].set(i, nm)
                for (const [i, h] of s.hits[kind]) hits[kind].set(i, (hits[kind].get(i) ?? 0) + h)
            }
            if (s.far) {
                if (!far) far = { ...s.far, sum: Float64Array.from(s.far.sum), sq: Float64Array.from(s.far.sq) }
                else { for (let i = 0; i < far.sum.length; i++) { far.sum[i] += s.far.sum[i]; far.sq[i] += s.far.sq[i] } far.n += s.far.n; far.emitted = s.far.emitted }
            }
            n += s.n; rays += s.rays; unit ??= s.unit; detectorHits = s.detectorHits
            return E
        },
        /** The totals as index.js has always given them, each { value, se }; se is null for one batch. */
        results() {
            if (!n) return null
            const merge = kind => [...hits[kind].keys()].sort((a, b) => a - b).map(i => ({ index: i, name: names[kind].get(i),
                incident: stat(`${kind}.${i}.incident`), absorbed: stat(`${kind}.${i}.absorbed`), hits: hits[kind].get(i) }))
            return { unit, rays, batches: n, ...Object.fromEntries(TOTALS.map(k => [k, stat(k)])), detectorHits,
                     objects: merge('objects'), materials: merge('materials'), interactionsPerRay: stat('ipr') }
        },
        /** The far field as optics/farfield.js reads it: the mean flux per bin and its standard error. */
        farField() {
            if (!far?.n) return null
            const m = far.n
            const flux = Float64Array.from(far.sum, v => v / m)
            const se = m > 1 ? Float64Array.from(far.sum, (v, i) => Math.sqrt(Math.max(0, far.sq[i] - v * v / m) / (m - 1) / m)) : null
            return { mode: far.mode, material: far.material, nC: far.nC, nG: far.nG, axis: far.axis, c0: far.c0, flux, se,
                     batches: m, rays, emitted: far.emitted, unit: far.unit }
        },
        _state: () => ({ n, rays, unit, detectorHits, far, stats, names, hits }),
    }
    return E
}
