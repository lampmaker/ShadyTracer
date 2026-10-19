# Blank-reader report: ch/compiles.html ("Faster compiles")

## 1. Teach-back
Before the graphics card runs ShadyTracer's programs ("kernels"), the browser must translate them, and big ones take seconds. This used to happen on the thread that draws the page, so the tab froze. Now each compile runs on another thread and hands back a promise, so the page keeps drawing. Asking for all of them at once means waiting about as long as the biggest, not the total: 11.2 s instead of 13.4 s. Only three kernels contain the scene, so adding a shape recompiles only those. The rest come from a cache keyed by the program's whole text. Going back to an earlier scene compiles nothing. The old bar counted finished kernels and stuck near the end. The new one follows a clock predicted from the biggest kernel's size. It reaches 90% at the predicted time, then creeps towards 99%. Each machine learns its own speed over a few builds.

## 2. Quiz
1. The plain call "waits, on the page's own thread", so nothing paints or answers a click. Now `createComputePipelineAsync` compiles on another thread and returns a promise. A trace is also refused during a build (section 5).
2. With `Promise.all` they compile side by side, so the wait ends with the last one. One at a time, the waits add up. **Not taught:** *why* they can run side by side (several cores is my *outside knowledge*), or why all at once (11.2 s) is slower than shade alone (10.7 s).
3. The march, surface and occlusion kernels, plus "four with the step cache on", but the page never names the fourth. Only those three have the scene in their text. The other thirteen declare only the renderer's own uniforms, so their text is unchanged and the cache finds it.
4. It counted kernels ready. The small ones finish in a few hundred ms, so the bar jumped to nearly full and waited on the biggest. The new bar uses elapsed over predicted time: 90% at the prediction, then easing towards 99%.
5. After each build, the slowest kernel's time per size is blended half-and-half into the rate kept in the browser. It refuses builds whose slowest kernel took under 300 ms, and builds more than four times faster than the kept rate (the browser's cache after a reload). "One stalled build moves the rate at most twice" I could not decode.

## 3. Where I got lost (worst first)
- **"Only three kernels hold the scene"**: why is a scene *text inside a program*? To me a scene is data. "Moving a shape compiles nothing" vs "adding a shape changes the scene's text" only made sense through *outside knowledge* (shapes compiled into the shader). Chapter 24 is pointed to, not summarised.
- **The surface kernel appears from nowhere.** Section 1 and figure 1 have shade, occlude, march and "ten small". Then section 2's slowest is "the surface one". Is it new, renamed, or split from shade?
- **"every call is a copy"**: why? That is *outside knowledge* (inlining).
- **"moves the rate at most twice"**: a factor of 2, or two builds?
- **"the browser's own cache"**: a second cache. Why does a reload empty ours and not that one?
- **"the user's card"** from section 1 on. Who is "the user"? This is explained only in section 5's "measured" card.

## 4. Words and symbols
- Explained only in section 4's code notes, after first use: driver, promise, pipeline. WebGPU is never explained. Thread is explained inline (good).
- Cards: **compile** and **pipeline cache** are clear. **uniform** made "moving compiles nothing" click. **kernel** adds "rounds", "sample" and "chapter 22", which I don't know.
- No card and never explained: march, shade, occlude, step cache, inlined, "base uniforms", node, profile, hash (code note only). The scene names Noise library and Menger cubes I guessed from the buttons.
- Version numbers (0.9.2, 0.10.0, 0.20.8, 0.21.6, 0.22.6) pile up, and I lost which number belongs to which version.

## 5. Figures
- **Figure 1** (timeline, three ways): the clearest thing on the page. It shows a red "frozen" band, then ticks, then stacked bars. Unexplained: the "ready" line at 11.2 s sits past shade's 10.7 s. Also, its "13 kernels" vs section 2's "sixteen".
- **Figure 2** (session grid): columns turning blue on "Add" and "Back to A" make the point. The caption's key is broken: "red if it holds the scene, orange if it does not, blue, or untouched (faint)". Blue means *what*? The tiny header ("compiled, from the cache, or nothing to do") rescues it. All columns are already filled at step one, so "Next step" only moves a highlight. Open B's 1.3 s is never discussed. The "before" screenshot flips both toggles together, so I can't separate their effects.
- **Figure 3 left**: very clear. Small clashes: "of 16" vs the text's "12 of 13". The readout measures the old bar at "nine tenths of the build" but the new one at "nine tenths of the prediction".
- **Figure 3 right**: grey bars climbing to blue and the orange reload are clear. I checked the rates: 22.8 = (15.2+30.4)/2, and so on. The labels are builds 1–7 plus a reload. The caption says "eight builds", the text says "the sixth is within 2%", and the readout reports the seventh.

## 6. Maths fold-outs
There are none. `compileFraction` is the only maths. 0.9·x I follow. `Math.exp` and "by e (about 2.7)" assume I know e, which I don't. "Size to the power 1.37" and "typical error a third" are stated but never explained.

## 7. The code
- tinywebgpu 1318–1323: with the note, "blocks vs off-thread, a `ready` promise" is clear. "Opts out of exactly that" points above the excerpt. `bind()` is opaque.
- raytrace_main 384–400: "costs the SUM ... this costs the longest one" is clear. Not explained: `Promise.all`. Opaque: `rebind`, `setResources`, "parks the values", `prog_march`. "Nine" and "four" need the note to correct them.
- genrays 7–17: the gist survives. Opaque: `R.trace`, "the whole bag", "schema", "callers filter instead". `computeUniformTypes` and `ComputeUniformTypes` are near-twins.
- tinywebgpu 1392–1398: "whole text, not a hash" is clear. Opaque: `finalCode`, `G.defines`, `computeDesc`, "topology", BUG-008.
- compileFraction: readable, except `!(expectMs > 0)` and `Math.max(0, …)`.

## 8. Too much, too little
- Too many numbers for one scene: Noise library at 13.4, 11.2, 10.7, 11.4→5.9, 6.3, 4.2/3.0→2.0/0.56, "over a minute" and "about 20 s".
- Section 5 is rushed: six topics, each bringing new words (step cache, "chapter 24's third way", lens assembly).
- Section 6 mostly repeats sections 1–4 with file:line references meaningless to me.
- Too little on why the scene lives in a kernel's text.

## 9. Wrong or contradictory (to me)
- Shade alone on the Noise library is **10.7 s** in figure 1 but **11.4 s** in section 1's text, on the same card.
- 15.2 ms per 1000 characters × 200,000 (surface) = 3.0 s, but figure 2 predicts 2.48 s. The 1.37 power might explain it, but I can't redo the sum.
- "Texts seen before" are said to take 2.0 and 0.56 s, yet figure 2 shows a seen text at 0.0 s.
- Kernel counts disagree: nine (code), four vs three (code vs text), 13 (fig 1, "12 of 13"), 16 (figs 2 and 3).

## 10. The five changes
1. Say early that the scene's shapes are written into some kernels' text. A new shape is new text. A move changes only a uniform.
2. Introduce the surface kernel and give the kernel-count history in one line (13 in 0.9.2, shade emptied in 0.20.8, 16 today).
3. Fix figure 2's colour key ("red/orange: compiled; blue: from the cache; faint: nothing"), and give each toggle its own step.
4. Explain the browser's cache vs the pipeline cache, and rewrite "moves the rate at most twice".
5. Reconcile the numbers in section 9, and define driver, promise and pipeline at first use.
