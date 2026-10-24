## Beginner review: "Two sizes for one lamp" (section 9)

**1. Teach-back**
In ShadyTracer a ray counts as hitting a surface once it gets closer than a small distance, the tolerance. Because of that, a ray passing just outside a lamp's edge also "hit" the lamp, so bouncing rays saw a lamp slightly bigger than its real size, with a glowing rim. Shadow rays aim only at the real lamp, so the two methods disagreed about the lamp's size. With NEE off, this made the floor too bright (5%, or 25% with a ten times larger tolerance). The fix was to make the rim black, the colour of the lamp's back, so that both methods use the lamp's true size.

**2. Quiz**
a. A ray moves in steps and counts as a hit when it is closer than the tolerance, so a ray passing within that distance of the edge counts. *Why* rays move in steps is never explained: I only know it from *outside knowledge* (sphere tracing).
b. With NEE on, a bounce that hits the lamp is given a weight, and for a small lamp that weight is almost nothing. So the rim hardly counted, and the shadow rays used the true size. With NEE off, the rim counted in full. The paragraph never says *why* the weight is small. I worked it out from the MIS card ("how likely it was to find that light") and from *outside knowledge*.
c. The paragraph gives three reasons. The rim is a side effect of the tolerance, not part of the lamp. The lamp's brightness is worked out from its size. The lamp's own rays start on its real surface. I could follow the first reason. The second only made sense when I linked it to section 2 (same total light, brighter when smaller), and the paragraph does not make that link. The page never taught me the third.

**3. Where I got lost** (worst first)
- *"the lamp's own rays, which later chapters start on it"*: what are these? Section 6 only hints at "tracing light from the lamp's side".
- *"A ray moves towards a surface in steps and can never land exactly on it"*: until here, rays were straight lines that hit things, as in school geometry. Why steps? The only clue is in the "normal" card.
- *"for a small lamp that weight is almost nothing, so the picture was right"*: why is the weight small, and is "almost nothing" the same as "right"?
- *"The lamp's brightness is worked out from that size"*: so what? The consequence (extra rim means more total light than the lamp was given) is left for me to work out.
- *"(The flat world's capsule really is that thick…)"*: thick as what, the tolerance? The fold-out said 0.02 but never called that a tolerance.
- *"takes the material of the lamp's back"*: what happens to a bouncing ray that hits a black rim? Does it stop? Does it now cast a tiny shadow?

**4. Words used before they were explained**
"material", "weighs it"/weight (pointed to "the next chapter"), "the lamp's own rays", "steps" (marching), "front/back" of a lamp (new, since the figures' lamps glow all round), "codegen.js:1404" (means nothing to me).

**5. Wrong or contradictory**
- My own sum does not give 5%. A 10 × 5 cm lamp grown 0.05 cm all round is 10.1 × 5.1 = 51.5 cm², 3% more, and ten times the tolerance gives 11 × 6 = 66 cm², 32% more. The page says 5% and 25%. There may be a reason (the lamp seen at a slant?), but the paragraph does not give one, so it reads as a mismatch.
- The paragraph says "the two halves of the estimate disagreed", but with NEE off there are no shadow rays. The error was measured against a formula, not against the other half.
- Section 2 says "a real scene has no such formula", while here the bug was found with a formula. The two can both be true (the test scene was simple), but nothing says so.
- Section 3 says "aim at exactly the light the bounces can find", while here the bounces were changed instead. The paragraph explains why, but it quietly turns the rule into "make them agree".

**6. Changes that would help most**
1. Say in one sentence why rays step, or link to where that is taught. Explain the rim as "the lamp's light plus extra light from a ring that is not really there".
2. Explain the small weight in one clause ("a random bounce rarely finds a small lamp, so its find counts little"), and say why the brightness reason matters: a bigger lamp at the same brightness gives more total light than it was set to.
3. Cut or explain "the lamp's own rays", and reconcile 5% with the simple area sum, or say why it differs.
