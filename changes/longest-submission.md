bump: patch

**A large render no longer loses the GPU by cutting its work by the frame's average.** A 3840 x 2160 render in the
Darkroom lost its device after a few batches (`DXGI_ERROR_DEVICE_HUNG`, Windows' two-second watchdog). The engine cuts
a heavy frame into submissions of about 150 ms, sized by the last frame's time spread evenly over its batches and its
wavefront iterations. Neither is even: a batch of camera rays is a band of the picture, and the band holding the object
costs several times the band of sky; and inside a batch the first iterations carry nearly all the rays. Offscreen,
nothing slices a sample, so at 4K the batches are as large as the ray buffer allows. The first two samples of a render
are cut every iteration (untimed, and the second recorded before the first is done), so the third is the first one cut
by the average, which matches "after a few". That is the inferred cause: nobody has measured a submission's time
on the card. Now every submission is timed by its own done, and the longest one in the last frame of the same shape
caps the next frame's cut at its iterations x 150 ms / its time, never below one iteration. The cap can only make cuts
finer than the old rule, so a scene the old rule already cut safely is unchanged, and a fast frame measured whole
stays whole. `RT.hud.submitMs` is the longest submission of the last timed frame, and `RT.hud.submissions` how many
that frame made. One iteration of one batch that runs past two seconds would still be lost: the cut cannot go finer
than that.

**What to look at:** the same render again, 3840 x 2160 in the Darkroom, with the same scene and samples. It should
finish. While it runs, type `RT.hud.submitMs` and `RT.hud.splitEvery` in the console and paste back what they say.
A `submitMs` near or over 1000 with `splitEvery` 1 means one iteration of a band is close to the limit by itself. The
next fix would then be smaller batches, not finer cuts. The live view should feel the same as before.
