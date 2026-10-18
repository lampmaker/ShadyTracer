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

**nee** (Aim at the light)
1. Why does a picture lit by a small lamp stay noisy for a long time?
2. What does next event estimation do at each bounce?
3. Why does the estimate divide by the probability of the choice it made?
4. Why can aiming at the light not help with a mirror?
5. With NEE on, why must a bounce that happens to hit the lamp not add the lamp's light again (in the flat world)?
6. What did NEE cost ShadyTracer in the measurement the page reports, and why is it kept anyway?
7. In 3D, how is the direction of a shadow ray towards a glowing ball chosen?

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
