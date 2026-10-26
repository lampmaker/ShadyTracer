# Second reader: "From light to pixels", two passages

*Round 13, 2026-10-25: a fresh reader, the page up to the end of "Tricks and trade-offs", reporting on the two passages
rewritten for the first reader.*

**Passage 1 (section 2, end of the AgX paragraph)**

(a) It says there are six curves besides "none", that a stronger AgX exists but the figure omits it, that the cd/m² light is unchanged by the curve, and that saved pictures also get an adjustable Hable version.

(b) Unclear points:
- "six curves besides none" does not match the figure's control, which lists none plus five (PBR Neutral, AgX, ACES, Reinhard, Hable). A student counting will find five and then have to work out that Punchy is the sixth. The numbers are right but the sentence makes you do the arithmetic.
- "the picture's light in candela per square metre is the same under each" is the most useful idea here, but it is buried. The tone-curve card says "the light itself is unchanged", so it is not new. Still, "the picture's light... is the same" reads oddly, because the picture on screen is clearly different. I only got it because the card helped.
- ACES, Reinhard and Hable are named and never described. The reader cannot tell what "a version of the Hable curve" is a version of. "White point", "toe" and "shoulder" were explained for toe and shoulder but not white point.
- "For a saved picture" appears before the page has said what a saved picture is. That only arrives in section 5.

(c) It interrupts. The paragraph is about AgX's look and ends on "It is a look, chosen for a picture", which is a natural stopping point. The two added sentences are inventory and a settings detail, and they shift the paragraph from explaining to cataloguing. The Hable sentence is the worst fit: a beginner has not met saved pictures yet.

(d) Suggested rewording: "The other curves in the figure (ACES, Reinhard, Hable) are further looks of the same kind; ShadyTracer also has AgX Punchy, a stronger AgX, which the figure leaves out. Whichever you choose, the light itself, in candela per square metre, does not change; only what the screen shows of it does." Move the Hable sentence to section 5, or drop it.

**Passage 2 (section 5, "A picture kept as light", last two sentences)**

(a) A saved picture can be adjusted before the tone curve. Example: a white balance removes a lamp's orange cast. Those tools run in a copy of the display code, and only once you move one. Otherwise the picture goes through the real displayPixel.

(b) Unclear points:
- "White balance" is never explained, and "orange cast" is only guessable. I knew it from outside knowledge.
- "Separate copy of the display's code" and "once one of them is moved" are vague. Moved how? What are "those tools"?
- "Still goes through displayPixel itself" is only meaningful because the previous sentence introduced displayPixel. The point, that an untouched save is guaranteed identical to the view, is lost in the mechanism.
- The "grade.js" citation is a detail a beginner will skip.

(c) It interrupts. The paragraph's claim is "a picture kept as light" and its payoff is "cannot differ from the view". Adding grading tools after that dilutes the payoff and invites the question of whether an untouched picture really matches. The next stamped paragraph, "The same picture, to the bit", answers that question and would follow naturally without the interruption.

(d) Suggested rewording, or a separate stamped item: "You can also adjust a saved picture before the tone curve is applied, for example with a white balance, which removes the orange cast of a lamp from the light. Those adjustments run in their own copy of the display code, and only after you have moved one of them, so an untouched picture still goes through displayPixel itself and matches the view." Better: put this after the "to the bit" paragraph, or under a new heading such as "Adjusting before the curve".
