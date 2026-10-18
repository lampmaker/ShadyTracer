# Beginner's reading report: "How to read this" (Chapter 0)

## 1. Teach-back
ShadyTracer is a program that makes pictures of 3D scenes in a web browser, using the graphics card. This tutorial explains how it works inside. Every chapter has the same parts, and the first time through I can skip the maths, the code and the "what went wrong" part. The figures are live: paragraphs with a dot change the figure, and I drag the ⊕ handles. Each colour and line style means the same thing in every figure. Most figures are a flat 2D slice. In 2D a lamp's light spreads round a circle, so it gets weaker as 1/r. In 3D it spreads over a sphere, whose area grows four times when r doubles, so it gets weaker as 1/r². The code shown on a page is loaded from the real files, and the page warns me if that code has changed since the page was checked. Claims are stamped *measured*, *read in code* or *inferred*, and speed is only ever measured on a real graphics card. I can use the online copy, or clone the code with git and serve it with Python.

## 2. Quiz
1. The question, the idea with its figure, the maths (folded away), the code, tricks and trade-offs, what went wrong before, "Try it", and words and reading. I can skip the maths, the code and what went wrong before. The page doesn't say whether I can skip "Tricks and trade-offs".
2. When I scroll to it or click it, it changes the figure next to it.
3. The light spreads round a circle in 2D (whose length doubles when r doubles) and over a sphere in 3D (whose area goes up four times). So a piece of the same size catches 1/2 or 1/4 of the light. I learned this.
4. The code has changed since the page was written, so the words around it may no longer fit.
5. *Measured*: someone ran it and wrote down the number, and the page says where and on what. *Read in code*: the code does this, with a link to the line. It says what the code does, never what it costs.
6. ShadyTracer's speed is the graphics card's speed. A computer without one can only imitate the card, slowly and differently.
7. A browser with WebGPU and a real graphics card. To run my own copy I also need git and Python 3. I type `git clone --recursive …`, `cd ShadyTracer`, `python3 -m http.server 8000`, then open http://localhost:8000/. For the tests I also need node. The page never says how to open a terminal.

## 3. Where I got lost (worst first)
- **The key (Fig. 1) lists things I've never met.** "a camera ray, … a shadow ray, … a step of the march." The page never gives even one sentence on how a renderer uses rays to make a picture. "camera ray: from the eye" goes against my physics, where light goes *into* the eye. The page does say chapter 1 explains this, which helped a little. I only understood how these pieces fit together from *outside knowledge*.
- **"anything that spreads light over directions spreads it over a half-circle in the flat world and over a half-sphere in 3D."** The line just before said a lamp spreads over a *whole* circle. Why half? (Outside knowledge: a surface only sends light out to one side.) The page doesn't say that.
- **"when a page says the user … it means the person who works on ShadyTracer."** To me "the user" means anyone who uses the program. "NVIDIA ones, of the Pascal family or the newer Ampere" means nothing to me.
- **Section 6, running it.** It never says what a terminal is or how to open one, or what "localhost" and "8000" mean. In my copy the three commands run together on one line: "git clone --recursive https://github.com/lampmaker/ShadyTracer.git cd ShadyTracer python3 -m http.server 8000". Typed like that, it would fail. "The results … were measured on NVIDIA cards": do I *need* NVIDIA? It doesn't say how I can tell whether I have "real graphics hardware".
- **"It loads every kernel against every example scene"**: I can't picture what loading a program "against" a scene means.
- **"in an imitation of the GPU's numbers, say"**: what are a GPU's numbers?

## 4. Words and symbols used before they were explained
- **ray**: used from section 1 on and never defined. Only my physics saved me.
- **path tracer** (in the renderer card): never explained.
- **march**: the card helps a bit, but brings in "Sphere tracing" without explaining it. "Moving a ray forward" is odd, because a ray is a line.
- **kernel**: the card's "Each of ShadyTracer's samples is a dozen kernels" uses *samples*, which isn't defined.
- **irradiance**: the card's "For the eye it is called illuminance" left me thinking it means what the eye sees.
- **intensity**: the card says "candela", which is never explained. The page doesn't say what units E comes out in.
- **normal**: the card says "shapes made of distances" and "height lines". I don't know what the first means yet.
- Also used without explanation: compiling (section 6, `?safe`), GitHub, terminal, localhost, `*.test.mjs` (what does `*` mean?), "the webgpu package" (how do I install it?), "signed distance functions" (in Try it), "semver build metadata", "template literals", "markdown", "out of scope".
- Cards that worked: GPU, WebGPU, shadow ray, camera ray, the three stamp cards, flat world.

## 5. Figures
- **Fig. 1 (the key):** clear as a legend. But it explains the look of things I don't know yet, so I won't remember it. "a handle: drag it (along this row)" is a nice touch.
- **Fig. 2 (lamp spreading):** the left side makes the point well. At r = 1, 4 of 36 rays reach the piece; at r = 2, 2 do, and the readout says ×0.50. The labels "2πr long" and "4πr² of area" carry the argument, but the text never mentions them. The right side only shows the rays to the patch's corners getting narrower. I can't *see* "a quarter" there; only the readout tells me. **The colours clash with the key:** the 36 thin rays are grey and dashed, which in Fig. 1 means "shadow ray that reached its light". The red piece is the same red as "blocked". I would also wonder what happens at r = 1.5, since you can't catch 2.67 rays. And why only 36 rays?

## 6. The maths fold-outs
There is one: E = I/r². I could follow it, and every letter is named. Pointing to section 3 for "why it is squared" works. It's missing units, and the link from "number of rays caught" to E is left to me.

## 7. The code
- **`smin`:** the label helps ("plain smaller of the two", Math.abs). But I don't know what "two distances" are distances *of*, or how taking the smaller of two numbers "melts shapes". `h * h * 0.25 / k` stays a mystery. `export const … =>` is syntax I haven't learned (*outside knowledge*). It works as an example of what a code box looks like, not of anything I can understand yet.
- **version.js:** the label's example string makes it clear. `await`, "never throws" and "semver" stay opaque.
- **check-shaders.mjs:** the label ("a backtick … ends the text early") carries it. "template literals", "markdown around an identifier" and "out of scope" are jargon.

## 8. Too much, too little
- **Too much for me:** the long paragraph in section 5 about View › Tests, tests.js:2642, and the Copy button. Also the tutorial's own checks in section 7. Both are for developers.
- **Too little:** a picture of the whole idea before the key; section 6's setup steps; why the 3D side gives exactly a quarter.
- **Long sentence:** section 2's first sentence, with its brackets inside brackets.

## 9. Wrong or contradictory
- The page says "the same colour and line mean the same thing in every figure", but Fig. 2 draws lamp rays the way the key draws shadow rays.
- Section 3 talks about a whole circle, then a half-circle, with no explanation.
- In my copy, Fig. 2's controls read "distance r 2.00", while the first screenshot shows 1.00. This is probably just the state when my copy was saved.
- "the user" means the developer here, but means ordinary users in section 1.
- "measured on NVIDIA cards" could be read as "you need NVIDIA".

## 10. The five changes, most important first
1. **Before the key, add 3–4 sentences on how the renderer works**: one ray per pixel from the eye, find what it hits, send a shadow ray to the lamp. Or say plainly: "you won't know these yet; come back to this key."
2. **Fix Fig. 2's ray style** so it matches the key, or say in the caption what the grey dashed lines are. **Make the 3D side countable** (for example a grid of rays: 16 caught, then 4), and mention 2πr and 4πr² in the text.
3. **Explain or cut the half-circle/half-sphere sentence**: a surface sends light to one side only.
4. **Section 6 for real beginners:** the commands on three separate lines, what a terminal is and how to open one, what localhost:8000 is, how to check for WebGPU, and whether non-NVIDIA cards work.
5. **Say outright that the code examples aren't meant to be understood yet** (point to the header and the label instead). Also drop or explain "the user", Pascal/Ampere, and the illuminance line on the irradiance card.
