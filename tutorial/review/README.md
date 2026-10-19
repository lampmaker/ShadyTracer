# The blank-reader review

*Every page of the tutorial is read by an independent reader who knows nothing about ShadyTracer before it is called
done (the user, 2026-10-18: "have every page read by an independent agent … so it goes in blank. this to test that it
is indeed understandable").*

## How

1. `node tutorial/review/extract.mjs <dir> [page ...]` writes each page as a reader meets it: `<dir>/<page>/page.md`
   (the text in reading order, the maths fold-outs open, the code as the page shows it, every figure's caption, controls
   and readout, what each underlined word's card says) and a screenshot of every figure as it starts and after each
   paragraph that moves it.
2. A fresh agent, one per page, gets the brief below with that page's questions, and may read **only** that folder:
   no other file of the repository, no search, no web. Nothing about ShadyTracer goes in that the page does not show.
3. Its report is kept in `reports/<date>/<page>.md`, and what changed because of it is written in
   [`REVIEWS.md`](REVIEWS.md): every finding either fixed, or answered with why not.
4. A page revised for its findings is read again, by a new reader, before it is called done. So is a section rewritten
   because ShadyTracer changed (`affected.mjs`, CLAUDE.md "The tutorial follows the code").

**What it is and is not.** The reader is a language model told to read as a beginner. It does know the subject, and
says when it understood something only because of that ("outside knowledge"). So its *"I got lost here"* is a strong
signal; its *"I understood"* is a weaker one, and the quiz is there to test it: answers the page did not give are
easy to spot. It cannot drag a figure, so a figure is judged by its screenshots and caption. None of this replaces a
real student.

## The brief

> You are reviewing one page of a tutorial by **reading it as a beginner**.
>
> **Who you are:** a 16–17-year-old student. You program a little (JavaScript: variables, loops, functions, arrays),
> know school maths (algebra, trigonometry with sin, cos and tan, Pythagoras, vectors as arrows with an x and a y; no
> calculus) and school physics (light travels in straight lines and reflects). You have never heard of ray tracing,
> path tracing, distance fields, Monte Carlo, shaders or GPUs beyond "the graphics card runs games". You do not know
> ShadyTracer.
>
> **The honest problem:** you are in fact a model that knows all of this. Put it aside, and notice every place where
> the page relies on knowledge a real beginner would not have. Whenever you understand something only because you
> already knew it, say so: *outside knowledge*.
>
> **Read only** the folder you are given: `page.md` and the screenshots it names. Do not open any other file, do not
> search the repository or the web. The page is interactive; the screenshots show its figures at each step. You cannot
> drag anything: judge whether the text, caption and screenshots make each figure's point.
>
> **Report**, in markdown, in this order, concrete and quoting the page:
> 1. **Teach-back:** in 5 to 10 sentences of your own, what did this page teach you, as the student would say it?
> 2. **Quiz:** answer the questions below using only what the page taught. Where the page did not teach it, say so.
> 3. **Where I got lost:** each place, quoted, and what was missing. Worst first.
> 4. **Words and symbols** used before they were explained, and whether the word's card helped.
> 5. **Figures:** for each, what you think it shows, whether its screenshots and caption make that clear, and anything
>    confusing (labels, colours, what to drag).
> 6. **The maths fold-outs:** could you follow them? Where not?
> 7. **The code:** did the text around each excerpt let you see what it does? Which lines stayed opaque?
> 8. **Too much, too little:** parts that felt long, repeated or rushed.
> 9. **Wrong or contradictory:** anything that seemed to disagree with itself or with the figures.
> 10. **The five changes** that would most help a beginner, most important first.
>
> Keep it under about 1200 words.

## The questions, by page

**reading** (How to read this)
1. What are the parts of a chapter, and which can you skip on a first reading?
2. A paragraph has a dot beside it. What does it do?
3. Why does the light from a lamp fall off as 1/r in the flat world but as 1/r² in 3D?
4. A piece of code on a page says "changed since this page was checked". What does that tell you?
5. What is the difference between a claim stamped *measured* and one stamped *read in code*?
6. Why are speed numbers never measured on a computer without a graphics card?
7. What do you need to run ShadyTracer yourself, and what do you type?

**rays** (Rays make a picture)
1. Why does a ray tracer usually start its rays at the eye instead of at the lamp?
2. What decides which direction a pixel's ray points in?
3. What is a shadow ray, and what does it tell you?
4. Why do edges look like stair steps without jitter, and how does jitter fix that?
5. If a picture has twice as many pixels across and twice as many down, how many more rays does one sample need?
6. Why does a lit point get less light when the light comes in at a slant?
7. What went wrong with rounding down the number of tiles, and why did it matter although the picture looked fine?

**distances** (Shapes as distances)
1. What number does a signed distance field give for a point inside a shape?
2. Why is it safe for a ray to move forward by exactly the distance the field gives?
3. Which rays take the most steps, and why?
4. What goes wrong if each step is longer than the distance (a step scale above 1)?
5. What does the surface tolerance decide, and what happens if it is too big?
6. What does a Lipschitz bound promise, and what is the fix when a formula breaks it?
7. How does ShadyTracer decide that a ray has left the scene?

**shapes** (Building and bending shapes)
1. How do you cut one shape out of another using only their two distances?
2. What does a smooth blend change, and what does its k control?
3. Why did the fillet look warped before the fix, although the surface was in the right place?
4. How does the renderer decide which solid a point is inside, and when can that answer be wrong?
5. Why does twisting a shape make it unsafe to march, and what is done about it?
6. The twist divides by √(1 + c²). What does the page say is wrong with that, and how sure is it?
7. Why does a ray marched through an undivided noise relief never stop, and what does the shell save?

**normals** (Which way is up)
1. What is a normal, and how is it related to the distance field?
2. How does the renderer find a normal for a shape that does not give one, and how many extra looks does it take?
3. Why are central differences more accurate than forward ones for the same step, and what do they cost?
4. Why is a very small step a bad idea on a GPU?
5. What is the floor of 128 spacings, and how was 128 chosen?
6. What did turning off the shapes' own normals cost, and what does the page say is not known about it?

**montecarlo** (Dice and averages)
1. How can random darts work out π?
2. What does an error bar say, and what does it not promise?
3. To halve the noise in a picture, how many more samples does it need, and why?
4. How does the renderer know each pixel's error bar without knowing the right answer?
5. What was wrong with the old random number generator, and why could more samples not fix it?
6. The page disagrees with a comment in the code. About what, and how sure is it?

**paths** (Following a path)
1. What is a path's throughput, and how does it change at each bounce?
2. What does a cap on the number of bounces do to the picture, and why is it worse in a white room?
3. How does Russian roulette stop paths early without making the picture darker?
4. Why does ShadyTracer still leave Russian roulette off?
5. What was the 6 to 8% brightening, and what did it teach?

**mis** (Two ways to the light)
1. Where does picking a point on a lamp do badly, and where does picking a direction from the surface do badly? Why?
2. What does MIS do with the two estimates, and why is nothing counted twice?
3. In the weights figure, what decides which strategy gets the larger weight?
4. Why did a glass ball once cast a plain shadow?
5. Why must both strategies use the same material, and what happened when they did not?

**photometry** (Measuring light)
1. What are lumens, candela, lux and candela per square metre each a measure of, and which one does a pixel hold?
2. A glowing panel is moved twice as far away. What happens to one pixel on it, and to the light it puts on the eye? Why?
3. The sun is set by its illuminance and its width. How does its luminance follow, and why does a wider sun not make a
   brighter picture?
4. Why does a white floor in the sun come out at ρE/π, and how close did the measurement come?
5. Why does ShadyTracer work out the sun's disc on the main processor rather than the graphics card?
6. What went wrong when two parts of the renderer tested "inside the sun" differently?

**colour** (Colour)
1. Why are three numbers enough to describe a colour to the eye, and where do X, Y and Z come from?
2. What is a chromaticity, and why do two lights mixed lie on the line between them?
3. What does a negative red, green or blue mean, and why does ShadyTracer keep it instead of clipping it?
4. What do a colour temperature and a Duv say about a light?
5. How are three LEDs mixed to a target colour, and when can they not reach it?

**pixels** (From light to pixels)
1. What does an EV set, and how does ShadyTracer choose one by itself?
2. Why does the meter drop the darkest and brightest tenth, and why does a lamp-lit room need a second rule?
3. What went wrong when black pixels counted?
4. What does a tone curve do, and how do PBR Neutral and AgX differ?
5. Why is a picture stored as sRGB rather than in proportion to the light?

**diffuse** (Diffuse and mirror)
1. What does it mean that a matte surface looks equally bright from every direction, and why does its intensity still
   fall with the cosine?
2. Why is a matte surface's BSDF ρ/π, and why does a bounce drawn by the cosine weigh exactly ρ?
3. Why can the renderer not aim a shadow ray through a mirror, and how is a lamp seen in a mirror found?
4. What is a white furnace, what should it show, and why does it need a black control?

**microfacets** (Rough and shiny)
1. What is a microfacet, and what does the roughness change?
2. Why does one reflection off a rough metal lose some light, and how does ShadyTracer give it back?
3. What was wrong with the old table of E, and why did warping its grid fix it?
4. What was wrong with the old sampler's density, and why could a test looking straight down not see it?

**glass** (Glass)
1. What do Snell's law and Fresnel's law each decide when light meets glass?
2. What is total internal reflection, and when does it happen?
3. Why does a pane let through (1 − R)/(1 + R) of the light, and how does the renderer get that without adding a series?
4. How does the renderer know which material is on the other side of a surface?
5. How does coloured glass absorb more when it is thicker?

**dispersion** (Rainbows)
1. Why does a prism split white light, and what do n_d and the Abbe number say about a glass?
2. When does a ray in ShadyTracer get a wavelength, and what happens to its three channels then?
3. Why do the channels' weights average to exactly 1, and why does that keep white light white?
4. Why does a prism's reflection stay white and free of colour noise?
5. How does a coloured coating work on three channels without any wavelength?

**emitters** (Every glowing thing is a light)
1. How does the renderer find glowing shapes nobody told it about?
2. Why is the picture right even before a glowing shape has been found?
3. How can random lines start light from the surface of a shape the renderer knows nothing about?
4. Why is the brightness kept as a logarithm, and what went wrong with the old code?

**lens** (The camera's lens)
1. How does the renderer make a pixel's ray through a lens instead of a pinhole?
2. Why is a point at the focus distance sharp and a nearer one blurred? How big is the blur?
3. What does a wider aperture do to the picture?
4. Why was the lens first added, and what part of that reason is gone now?

**nee** (Aim at the light)
1. Why does a picture lit by a small lamp stay noisy for a long time?
2. What does next event estimation do at each bounce?
3. Why does the estimate divide by the probability of the choice it made?
4. Why can aiming at the light not help with a mirror?
5. With NEE on, why must a bounce that happens to hit the lamp not add the lamp's light again (in the flat world)?
6. What did NEE cost ShadyTracer in the measurement the page reports, and why is it kept anyway?
7. In 3D, how is the direction of a shadow ray towards a glowing ball chosen?

**caustics** (Caustics)
1. Why can a shadow ray from the floor not find the sun through a glass ball?
2. What is light tracing, and which light does ShadyTracer give it?
3. What goes wrong if both the camera's paths and the photons count a caustic?
4. Which kind of path does the camera keep though it finds it only by chance, and why?
5. How does the renderer decide where to start photons, and why connections per photon sent rather than connections?
6. What does the 20% floor protect against?

**photons** (Photon mapping)
1. What is stored in a photon map, and when does a camera path gather from it?
2. What goes wrong with a large radius, and with a small one?
3. Why does a fixed radius never reach the right answer however many samples, and how does a shrinking one?
4. Why does a gather visit only two cells in the flat world (eight in 3D)?
5. What is a collision in the hash table, and why does it not count a photon twice?
6. How can walking only some of a cell's sub-lists still be right on average?

**haze** (Dust in the air)
1. What does the mean free path mean, and what share of light crosses a length L?
2. How is the distance to a particle drawn, and what weight does the ray carry after it?
3. What does the asymmetry g change?
4. Why is the beam nearly missing with the bounces only, and what does aiming at the sun from the air add?
5. Why does a furnace that reads 1 with no noise not prove on its own that the dust is right?
6. Why was the collision moved to be drawn when the leg starts?

**gpu** (A GPU for beginners)
1. Why does a group of threads take as long as its slowest one?
2. Why do neighbouring pixels waste less than shuffled ones?
3. Why does a single number after a vec3 not need a new 16-byte row?
4. What is a dispatch, and what limit did the resolve kernel hit?
5. Why must a submission not run too long?
6. What happened with the barrier the checker passed?

**wavefront** (Wavefront path tracing)
1. What happens in one iteration, kernel by kernel?
2. Why does the number of rays fall from one iteration to the next, and what is the drained tail?
3. Why 24 iterations at ShadyTracer's defaults?
4. What is the flush, and what does a too-short budget cost?
5. How does the card know how many workgroups the next kernel needs without the main processor reading a count?
6. Why does a wavefront keep the lanes busier than one big kernel?

**accumulate** (Adding up light on a GPU)
1. Why do six threads adding with a load and a store end with the wrong total?
2. How does a compare-and-swap loop add a float correctly, and what does it cost when many threads hit one pixel?
3. What went wrong with storing light as whole numbers at 65,536 a unit?
4. Why is the picture's average updated only once a sample, one thread a pixel?
5. Why is a big picture traced in batches, and why do they add up to one sample?

**codegen** (From scene tree to shader)
1. What is the difference between a value that is a uniform and one that is baked?
2. Which edits need a new compile with code and uniforms, and which with baked code?
3. Why does the scene as data need no new compile for a ball added, and when would it need one?
4. What is a kernel's inlined size, and why does calling SDF in more places make compiling slower?
5. Why is data not always the better choice?

**measure** (Measure first)
1. Why was the plan to change ShadyTracer's architecture wrong, and what showed it?
2. How does ShadyTracer find out how long each kernel takes on the card?
3. What is the gap between passes, and how is it different from wall clock?
4. What does a browser's rounding of timestamps do to one pass, and to the sum of many?
5. Why can two runs of the same code read different times, and how do you compare two versions anyway?

**steps** (Fewer and cheaper steps)
1. Why does every step of a ray cost something for every object in the scene, and what makes a step dear?
2. How does a box let an object be skipped, and why is the answer still safe to step by?
3. Why does ShadyTracer put boxes only around some objects, and only at the top of the scene?
4. What is a relief's shell, and why did it save less than was expected?
5. How can a ray move without asking the scene at all, and what went wrong with the first way the cache was filled?

**compiles** (Faster compiles)
1. Why could a compile freeze the whole page, and what stops it now?
2. Why does compiling all the kernels at once take about as long as the slowest, and not the sum?
3. When a shape is added, which kernels compile again, and why do the others not?
4. Why did the old progress bar stick near the end, and how does the new one decide where to be?
5. How does the bar learn a machine's own speed, and which builds does it refuse to learn from?

**feel** (Feeling fast)
1. How does the live view decide how many samples to trace each frame, and why did the old rule hunt?
2. What does the view draw while you drag the camera, and how does it know you are dragging?
3. Why is a heavy sample cut into pieces across frames, and why can it not always fit 30 ms?
4. Why is a heavy frame sent to the graphics card in several submissions?
5. How does having two samples in flight make an offscreen render faster?

**index** (the contents)
1. What will you learn in this tutorial, and do you need to know anything before starting?
2. What do the three stamps mean?
3. In the figures, what do the different kinds of lines mean, and what can you drag?
4. Where do you go when you meet a word you do not know?

**glossary**
1. Pick the five entries a beginner would look up first. For each: did the definition alone make sense?
2. Which entries use words you would have to look up again?
3. Do any two entries disagree, or is any definition circular?

**styles**
1. What is this page for, and how do you change the style of the pages?
2. Is there anything on it you did not understand?
