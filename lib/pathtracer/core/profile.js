//======================================================================================================================
// PROFILE SCENES AND DEVICE -- the device the benchmark compiles uncached through (profileWG), and a one-sphere
// scene the engine's tests build on, here so that check-shaders compiles them too.
//
//   sphereScene(scene) one sphere and the default material, on the scene's own uniforms: a kernel with next to no
//                      scene in it
// (freshScene, the SDF wrapped so no cache had seen it, went in 0.22.6 with RT.profileCompile, the console diagnosis
// that was its only user; R.compileUncached, the benchmark's, does the same job through profileWG.)
//======================================================================================================================

export const sphereScene = scene => ({ ...scene, id: 'profile-sphere', pickWgsl: undefined, opticsWgsl: undefined, opticsPickWgsl: undefined, wgsl: `
fn getMaterial2(C: Hit, checkInside: bool) -> Material2 { return makeDefaultMaterial(); }
fn SDF(r: Ray) -> Hit { var C = emptyHit(r); C = add_new(C, Nsphere(r.pos, 1.0), 1u); return C; }
` })

/* The guard's number: at or above 2^31, which no workgroup id reaches (wid.x < maxComputeWorkgroupsPerDimension,
   the spec's default 65535, and a dispatch past the device's limit is refused), drawn from 2^31 values. It
   used to be one of 65535: a shader cache that outlives the page could have met the same text on an earlier
   run, one chance in 65535 per scene per run. */
export const guardValue = nonce => 0x80000000 + (Math.abs(Math.floor(nonce)) % 0x80000000)

/* The guard itself, on the WORKGROUP id. It was on gid, the invocation id, and Tint refused lt_build (the
   user's Chrome, 2026-09-29): "'workgroupBarrier' must only be called from uniform control flow". A return
   that depends on gid makes everything after it non-uniform, and lt_build has barriers after it. WGSL's
   uniformity analysis counts workgroup_id and num_workgroups as uniform and the invocation ids as not (the
   uniformity rules, gpuweb PR #1571), so a return on wid is allowed before a barrier. naga accepted the gid
   version (check-shaders pass four compiled it clean), which is why pass two now lints for that shape. */
export const guardLine = nonce => `if (wid.x == ${guardValue(nonce)}u) { return; }   // uncached: a guard no cache has seen\n`

/* A DEVICE THAT COMPILES NOTHING FROM A CACHE, for the benchmark's uncached compile (raytrace_main.js
   R.compileUncached): every kernel it is asked for gets one line in front of its entry point -- a test of the
   workgroup id against a number no dispatch reaches. The WGSL is then text nothing has compiled before, and
   the guard is live code (no compiler knows the dispatch size), so what the browser generates from it should
   differ too -- inferred, not measured. It returns only where no dispatch reaches, so the kernel does nothing
   different. Unlike freshScene above it changes EVERY kernel, the ones with no SDF in them too. In the profile
   built from freshScene, five of its eight kernels had no SDF, so their text was the live kernels' byte for
   byte (read in code), and they came back in 0-3 ms (measured) -- most likely from the cache, while a real
   scene change took 507 ms for genrays alone (measured, PERFORMANCE.md). Changing every text removes the
   question.

   And EVERY KERNEL ASYNC: a sync pipeline's `ready` resolves the moment it is created (tinywebgpu.js
   makePipeline), before any compile, so in the first uncached run nine of the thirteen kernels -- all but
   genrays, march, occlude and shade -- were in the timing as 5-44 ms whatever they cost, and lt_build's
   failure was a console line only. Async, `ready` waits for each one's own compile and rejects if it fails.
   The live build is not touched: this device exists only for the measurement.

   And NOTHING FROM TINYWEBGPU'S OWN CACHE, nor into it (`cache: false`). The guard already makes every text new,
   so a lookup would miss anyway; the opt-out is for the other direction: thirteen throwaway pipelines a benchmark
   row, entered, would push the live scene's out of the cache's bounded room (tinywebgpu.js makePipeline). */
export const profileWG = (WG, nonce = Math.floor(Math.random() * 0x80000000)) => {
    const guard = guardLine(nonce)
    const dev = Object.create(WG)
    dev.makeCompute = (body, main, uniforms, resources, opts = {}) =>
        WG.makeCompute(body, guard + main, uniforms, resources, { ...opts, async: true, cache: false })
    return dev
}
