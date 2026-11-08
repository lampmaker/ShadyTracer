bump: minor

**The Darkroom shows a render while it runs, and Stop keeps it.** A render in the Darkroom used to show nothing until
its last sample, so whether it had enough samples was only seen at the end, and Abort threw the samples away. Now the
render so far is copied into the Darkroom after a second and then every *show every* seconds (a new row in Render; 0
shows it only at the end), or at once with **Show now**. It is the picture kept, so every developing box -- exposure,
white balance, tone, colour, curves, wheels, grading, finish, the histogram, the spot meter and the eyedropper -- works
on it while the samples come in. **Stop and keep** (it was Abort) ends the render and keeps what it has, its sample
count said; raising **samples** while it runs renders further. Save and Discard wait for the render's end: an export
reads the picture in strips, and the render copies into it between them. The progress line sits at the top of the
picture, not in its middle. The copies go into the buffer already kept (`develop.js` update), so watching costs one
buffer copy each time and no memory; the exposure the display metered is read with the first copy and the last.
A script's `render` is unchanged.

**What to look at:** Darkroom, a render of a few hundred samples at a size that takes a minute: the picture should
appear after about a second and sharpen every five; drag the exposure and a curve while it runs and see the picture
follow (each change may lag by about a sample's time, since the GPU finishes the sample in flight first -- say if
that is too slow); **Show now** at once; **Stop and keep** part way, and the caption and status should say the samples
kept; raise **samples** during a render and it should go on past the old number. Whether the live view or the render
slows down while the Darkroom is redrawn during it is a measurement only your card can make.
