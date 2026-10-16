//======================================================================================================================
// A SAMPLE IN BATCHES (core/raytrace_main.js R.trace, every sample): every pixel its camera ray and every photon
// source all it asked for, whatever the picture's size.
//
// The ray buffer holds R.maxRays (~2.10 M since 0.44.0; ~2.31 M when this was written) rays. Until 0.38.1 a sample was ONE fill of it: the camera rays came first,
// one a pixel, and the photons -- light tracing's own and every other module's (R.photonSources, the optics sources
// lighting the picture) -- shared what the camera left (sharePhotons, here). So the picture's size decided what light
// was traced: at one photon a pixel the photons thinned out above ~1.15 Mpx, and from ~2.31 Mpx they got none, light
// tracing switched itself off, and the light that only it carries was gone -- a save of glass cubes in the sun with
// plain black shadows where the view had blue light through them (the user, 2026-10-08: "the picture size should have
// no impact on the rays traced"). Above the cap the camera rays were cut too, so a sample covered part of the picture.
// (Sharing the buffer in proportion, for an offscreen picture only, was tried first and never merged: the light came
// back, but a sample still traced less of everything at a larger size, and the live view kept the old rule.)
//
// Now a sample that does not fit runs in batches: each stream is split over K batches, each batch fills the buffer
// at most, runs the whole wavefront chain, and leaves its contributions in the frame and splat buffers, which resolve
// folds into the picture once, after the last. Every stream is the same at any size: one camera ray a pixel, every
// photon asked for, each divided by the sample's whole count (photoncount, emitPhotons, a source's total) -- so the
// size changes the resolution and the time a sample takes, and nothing else.
//
//   const p = planBatches(budget, [px, emit, sun, ...sources])
//   p.batches                 how many batches          p.part(s, k)   stream s's count in batch k
//   p.first(s, k)             stream s's index of batch k's first item (the camera's raygen tile)
//
// MORE BATCHES THAN FIT, ASKED (minBatches, 0.58.0): the live view's sliced samples (R.trace, A SAMPLE OVER SEVERAL
// FRAMES) cut a slow sample into more batches than the buffer needs, one or a few a frame, so the GPU is never held for
// a whole sample at once. The same split: each batch is as fair a slice of every stream as when the buffer forces it.
//======================================================================================================================

/** Stream n split into K parts as evenly as integers allow: part k. The parts add up to n exactly. */
export const splitPart = (n, K, k) => Math.floor(n * (k + 1) / K) - Math.floor(n * k / K)

/**
 * @param budget   the rays a batch may hold (R.raybufferSize)
 * @param streams  each stream's items this sample: camera rays, emitter probes, sun photons, each source's photons
 * @param minBatches  at least this many (never more than the items, so no batch is empty)
 */
export function planBatches(budget, streams, minBatches = 1, { first = null } = {}) {
    if (first?.length) return planInOrder(budget, streams, minBatches, first)
    budget = Math.max(1, Math.floor(+budget || 0))
    const n = streams.map(s => Math.max(0, Math.round(+s || 0)))
    const total = n.reduce((a, b) => a + b, 0)
    /* THE FEWEST BATCHES WHOSE LARGEST FITS. A batch holds at most ceil(n/K) of each stream (splitPart), so K is the
       least with their sum within the budget -- from total/budget up; the rounding adds at most one a stream. */
    const fits = K => n.reduce((a, s) => a + Math.ceil(s / K), 0) <= budget
    let batches = Math.max(1, Math.ceil(total / budget))
    while (!fits(batches) && batches < total) batches++
    batches = Math.max(batches, Math.min(Math.max(1, total), Math.floor(+minBatches || 1)))
    return {
        batches, total, streams: n,
        part: (s, k) => splitPart(n[s], batches, k),
        first: (s, k) => Math.floor(n[s] * k / batches),
    }
}

/* SOME STREAMS FIRST, IN BATCHES OF THEIR OWN (0.60.0; core/sppm.js): the photon map stores a sample's photons and its
   camera rays gather from it, so every photon of the sample must have landed before the first camera ray does --
   `first` names those streams (the photons), and they run in the plan's first batches, the rest after. Each group is
   planned as above, on its own; minBatches is shared between them by their sizes, one at least each. A group with
   nothing in it has no batch. The plan reads as any other: part(s, k) is 0 in the other group's batches. What it costs:
   a sample that fitted one batch is two now (inferred: a second wavefront chain's fixed cost; not measured). */
function planInOrder(budget, streams, minBatches, first) {
    const n = streams.map(s => Math.max(0, Math.round(+s || 0)))
    const inFirst = n.map((_, s) => first.includes(s))
    const only = keep => n.map((v, s) => inFirst[s] === keep ? v : 0)
    const tf = only(true).reduce((a, b) => a + b, 0), tr = only(false).reduce((a, b) => a + b, 0), total = tf + tr
    if (!tf || !tr) return planBatches(budget, n, minBatches)
    const mf = Math.max(1, Math.round((+minBatches || 1) * tf / total)), mr = Math.max(1, (+minBatches || 1) - mf)
    const pf = planBatches(budget, only(true), mf), pr = planBatches(budget, only(false), mr)
    const Kf = pf.batches
    return {
        batches: Kf + pr.batches, total, streams: n, firstBatches: Kf,
        part: (s, k) => inFirst[s] ? (k < Kf ? pf.part(s, k) : 0) : (k < Kf ? 0 : pr.part(s, k - Kf)),
        first: (s, k) => inFirst[s] ? (k < Kf ? pf.first(s, k) : n[s]) : (k < Kf ? 0 : pr.first(s, k - Kf)),
    }
}
