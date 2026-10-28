bump: patch

**The live rays no longer switch themselves off when the scene is rebuilt.** The rays' loop stopped at the first trace
that failed, and a trace can fail for a moment whenever the scene is rebuilt under it: the renderer puts the new scene
in before its values are ready, and every structural edit opens that window -- so does the background bake, once the
edits stand still. The rays now do what the Live analysis already did: nothing is traced while a scene is being built,
a trace that fails with the scene swapped or a build begun under it is let go, and only a failure with the scene as it
was switches the rays off, saying why in the status line (`rays stopped: ...`).

**What to look at:** switch the rays on (the view's analysis drawer, RAYS) and edit the scene -- add or delete a
shape, change a group's join, then stop and let the bake swap in. The rays should stay on throughout. If they still
switch off, the status line under the run bar says `rays stopped:` and the reason: that message is the next clue.
