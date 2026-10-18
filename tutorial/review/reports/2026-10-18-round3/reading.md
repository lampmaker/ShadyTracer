# Beginner's read of Chapter 0, "How to read this"

## 1. Teach-back
ShadyTracer is a program that draws pictures of 3D scenes in a web browser using the graphics card. This tutorial explains how it works inside. How to *use* it is in its Help (F1). Every chapter has the same parts: a question, the idea next to a live figure, a hidden maths box, real code, tricks with a "how sure" stamp, old bugs, things to try, and a word list. All the figures use one colour key, and you can drag the ⊕ handles. Most figures are a 2D slice called the "flat world". There, a lamp's light spreads round a circle, so twice as far means half the light (1/r). In 3D it spreads over a sphere with four times the area, so you get a quarter (1/r²). The code on the pages is loaded live from the real files, and a warning appears when it has changed since someone wrote the words. Each claim is stamped measured, read in code or inferred. Speed is only ever measured on real graphics cards. You can use the website, or download the code and run it with a small Python web server.

## 2. Quiz
1. The parts are: question, idea and figure, maths fold-out, ShadyTracer's code, tricks and trade-offs, what went wrong before, try it, and words and reading. The page only says the maths can be skipped ("Every chapter reads without it"). It doesn't say whether I can skip the code or the bug history on a first read.
2. It changes the figure beside it when I scroll to it or click it.
3. In the flat world the light covers a circle of length 2πr, so doubling r doubles the length and the piece gets half. In 3D it covers 4πr², so doubling r gives four times the area and the piece gets a quarter.
4. The code shown is today's, but the words around it were written for older code and may no longer fit.
5. *Measured* means someone ran it on a real card and wrote the number down (who, which card, the number, where). *Read in code* means the code visibly does this, with a link to the line. It tells you what the code does, never how long it takes.
6. A computer without a graphics card can only imitate one, slowly and differently. Not answered: doesn't every laptop have *some* graphics? Does built-in graphics count as "a real graphics card"?
7. I need a WebGPU browser (versions listed), a real graphics card and a web server. I type `git clone --recursive …`, `cd ShadyTracer` and `python3 -m http.server 8000`, then open localhost:8000. **Not taught:** that git and Python must be installed first. The page even says "Nothing is built or installed".

## 3. Where I got lost (worst first)
1. **The tests.js excerpt.** It uses `${build ? `${build} · ` : ''}`, `ctx.build?.()`, `try { } catch { }`, "installUI's `build`", "git revision", "kernel fingerprint", "benchmark row", "shader", `Q.w`, `adapter` and "timing wall clock". Its label says "highlighted parts are filled in when the kernel is built", but the page itself calls this JavaScript, not a kernel.
2. **The version.js excerpt** starts "Why both:". Both what? It is all comments, with no code at all, and mentions "(CLAUDE.md)" and "tests.js kernelFingerprint". It is the first example of "reading the code" and has nothing to read.
3. "A matte surface … (½ in one, 1/π in the other: chapter 8)". ½ and 1/π of *what*? "Matte" isn't explained either, and "every law with a direction in it" is vague.
4. **Section 7:** "Most of what can be checked without a graphics card is, by small programs run with node." I needed three reads. Also unexplained: node, pull request, "test.yml:23", **CLAUDE.md** (twice, never said what it is; outside knowledge), "webgpu package", Playwright, "a browser with no window".
5. **Section 6:** "secure context", "repositories" and "submodule" are git and web jargon.
6. "Within a style … drawn in the style you are reading in". What is a style, and where do I choose one?
7. The figures run ShadyTracer's own code for "a shape, a blend, a random number generator, a lens". Why does making a picture need random numbers? What is a blend?
8. "Camera ray: from the eye". In physics light goes *into* the eye. Why do these rays go out? Not said.

## 4. Words and symbols
- **shader** appears in both excerpts and has no card. I only know it means kernel from outside knowledge.
- **GPU** (kernel card): the text always says "graphics card" and never links the two.
- **sample** ("each of ShadyTracer's samples is a dozen kernels"), **path tracer** (renderer card), **sphere tracing** (march card), **candela**, **illuminance**, **tinywebgpu**: the cards bring in new words they don't explain.
- **normal** card: "shapes made of distances" and "height lines" mean nothing yet.
- **blocked ray** (in the key) has no card. Is it a shadow ray that hit something?
- template literal, identifier, markdown, "out of scope".

These cards helped: renderer, flat world, camera ray, shadow ray, kernel (mostly), WGSL, and the three stamps.

## 5. Figures
**Fig 1 (key):** the line styles are clear. Confusing:
- "a step of the march (chapter 2)" is drawn as a pale circle. Why is a step a circle? Only outside knowledge (sphere tracing) tells me.
- The key's handle says "drag it (along this row)", but the figure has "Controls: none". Can I drag the key?
- How the grey "shadow ray that reached its light" and the red "blocked" ray relate isn't said.

**Fig 2:** the flat side works well. Near shows 4 orange rays hitting the red arc, far shows 2, and the readout says ×0.50. The 3D side is weaker:
- No rays are drawn, so I can't *see* the quarter, only read it.
- The red piece is a trapezoid sitting on top of the sphere like a lid. It took me a while to read it as a square patch seen in perspective.
- The 3D readout's "(×0.25)" doesn't say "of r = 1".
- One thing has three names: the caption says drag the handle to move "the piece", the slider is "distance r", and Try it says "put the circle at 1.0".

## 6. The maths fold-out
E = I/r² is easy algebra, and every letter is named. But it says "why it is squared is the next section", and the next section is "Reading a figure". The answer is in section 3. It says "straight in front of it" but not what changes otherwise. Only the intensity card mentions "slant".

## 7. The code
- **version.js:** the plain-words line gives the purpose. The excerpt itself is opaque ("Why both", "this names the whole page").
- **tests.js:** the plain-words line ("version and revision, the picture's size, and the graphics card") let me *guess* that `build` is the version, `Q.w x Q.h` the size and `adapter` the card. Lines 2645–2647 stayed opaque.
- **check-shaders.mjs:** the best one. The line above explains the backtick problem, so the excerpt made sense. Still unexplained: "template literals", "identifier", "markdown".

## 8. Too much, too little
- **Too much for a first read:** the three kinds of test files, the paragraph on the tutorial's own checks, CLAUDE.md and test.yml. They are for people changing the code and should say so.
- **Too little:**
  - What a "ray" is in a renderer, and why rays are used at all.
  - What to install before section 6.
  - How to find "a kernel" in a file for the Try it backtick exercise.
- **Rushed:** the matte-surface sentence.

## 9. Wrong or contradictory
- "the next section" should be section 3.
- "filled in when the kernel is built" is on a JavaScript excerpt that is not a kernel.
- "Every chapter has the same parts, in the same order", but this chapter has no question, no "what went wrong before", and so on.
- "Nothing is built or installed", yet I need git, python3, node, the webgpu package and Playwright.
- The key tells me to drag a handle, but the figure has no controls.
- The figure is described three ways: handle, piece, circle.

## 10. The five changes
1. **Make the first code excerpts readable.** Pick one with real, simple code, or explain the tests.js lines one by one (what `${}` does, what `adapter` is), and fix the "kernel is built" label.
2. **Say what to install** before section 6 (git, Python 3, Node for the tests) and how to check the browser has WebGPU. Reword "Nothing is built or installed". Mark section 7 as "for when you change the code" and explain or drop CLAUDE.md, pull request and Playwright.
3. **Fix the pointer** "the next section" to section 3. Say which parts besides the maths can be skipped on a first read.
4. **Explain or cut the matte ½ / 1/π sentence.** Add cards for shader, GPU and sample, and say what a "style" is.
5. **Improve the figures.** In fig 2's 3D side, draw the rays reaching the patch (e.g. 4 → 1), and use one name for the thing you drag. In fig 1, add "(the circle is explained in chapter 2)" to the march step, and say why camera rays leave the eye.
