# Second reader: ch/steps.html, section 5's arrays and section 7's "A window that made it slower"

*A fresh reader of round 13 (2026-10-25), on the two passages as rewritten for the first reader. It read the page from
its start to the end of section 5, and section 7's first item. Kept as the reader wrote it.*

## 1. Teach-back
An array is a group drawn again at many places, and its copies are joined by "nearest wins", like the root's children.
So, as with boxes, a copy far from the point can be skipped if a lower bound on its distance stands in for it. Now only
a window is asked: the copies around the closest one, found from where the point sits along the row or from its angle
round the ring. Copies are asked outward on each side until the next one's bound is beyond the margin, and that bound
stands in for all the copies past it. The first version was slower than asking every copy, for two reasons:
- a per-copy switch made neighbouring pixels run different cases one after another;
- the measured boxes covered all the copies, because every copy had the same tag, so the bounds were huge and rays
  crept along.

After the fix the window takes more steps (30 against 21), but each step asks a few copies instead of 256.

## 2. Quiz
- **(a)** The copies are joined by nearest-wins, the same join as at the root, so a lower bound can stand in safely.
- **(b)** The window is the few copies around the closest one. For a row, the closest is the copy at the point's place
  along it; for a ring, the copy at the point's angle. No copy is asked to find it.
- **(c)** A row: the distance to the next copy's box. A ring: the distance to the sphere round the next copy's box, but
  never less than the distance to the band, so that above or below a flat ring the step can be longer. I could only
  make the page's reason work by reversing it (see 5).
- **(d)** The switch: pixels disagreed on the case, so the card ran the cases one after another. And the bounds were
  huge, so the steps were short.
- **(e)** Each step costs a few copies instead of 256. Why the window takes more steps at all, I had to infer from
  section 1 (a bound standing in can shorten a step); these passages do not say it.

## 3. Where I got lost (worst first)
1. "Above or below a flat ring of lamps, the band is near and the spheres are not, so the band gives the longer step."
   Section 1 taught me that a nearer bound means a shorter step, so a near band should give the *shorter* step. I could
   only make sense of it by assuming the reverse of what is written: the spheres stick out of a flat ring and come
   close, while the band stays farther.
2. "But never less than the distance to the band": take the larger of the two. Section 2 warned me that "the larger of
   two" is what breaks things. Nobody says why it is safe here (both are lower bounds on the same distance, so the
   larger is still one). I worried for a whole paragraph.
3. "the 4 cm lamp came out 2.2 m across, and the bound round 'one copy' was a sphere 2 m wide": how can a sphere round
   a box be narrower than the box?
4. "the array's own culling box had been measured as too big in the same way": the array's box is *supposed* to cover
   all its copies, so why would counting all copies make it too big?
5. I never learn the 256 lamps' shape: a row, a ring, or rows in a ring? "sphere" in section 7 suggests a ring, and "a
   row of 16" in section 5 is a different scene.
6. "a bench row that kept the switch … 43% slower than the plain loop": what is the plain loop, and how did it get each
   copy's place without a switch?
7. "only grows on each side of its least": "its least" is hard to parse; "its smallest value" would be clearer.
8. Why a ring uses spheres and a row uses boxes is still not said. I guessed that a turned box does not stay
   box-shaped, but that is a guess.

## 4. Words used before they were explained
- **sample**: only in the "kernel" card, which hangs off a different word in section 4.
- **shadow ray**: not explained; the chapter 14 sentence is noise to me.
- **Ampere**: never said what it is. Pascal at least gets "GTX 1080 Ti".
- **tag**: "its name, its tag" reads as if they were the same thing.
- **Also:** bench row, plain loop, switch (I half know it from JavaScript), arrays.js:19, and "a software copy of a
  graphics card" (understandable, a little vague).

## 5. Wrong or contradictory
- The band sentence's "near … so longer step" (point 1).
- A 2 m sphere round a 2.2 m box.
- Section 7's "the bounds are the box-shaped ones of section 5", while section 5's ring bound is a sphere.
- "Every copy asked" reads 270 ms in section 5 and 281 ms in section 7, on the same Pascal card, with no reason given.
  It is 465 ms on Ampere, where the card I was told is newer is slower than the older one. Without a word on settings
  or scenes, it looks like an error.
- The fixes are told in a different order in each place.

## 6. The three changes that would most help
1. Fix the band sentence to match section 1's logic: the *farther* bound gives the longer step. Add one clause on why
   taking the larger of two lower bounds is safe here, unlike in section 2.
2. Make section 7's numbers agree: the box size against the sphere size, "box-shaped" against sphere, and 270 against
   281 against 465 ms, each labelled with its card and run. Describe the 256-lamp scene's layout once.
3. Explain the array's too-big box and what "the plain loop" was, and say in one line why a ring takes spheres and a
   row boxes.
