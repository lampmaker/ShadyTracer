bump: patch

**Opening another project in the Project panel stays in the panel.** Until now a click on a project switched straight
to the viewport and compiled the scene it was last left on -- seconds spent on a scene that may not be the one wanted.
Now the panel shows the project's scenes and compiles nothing; a click on a scene card compiles that one and brings the
picture back. Bringing the picture back without choosing (the Viewport tab, or *Back to …*) compiles the scene the
project was left on, and so does opening a project while the viewport is in view beside the panel. A scene that will
not compile leaves the empty scene, as before, rather than the last project's picture.

**What to look at:** in the Project panel, click another project: the panel should stay, its scene cards shown, the one
it was left on marked *not compiled yet*. Click a different scene: it compiles and the viewport comes forward. Open a
project again and click the Viewport tab instead: its last scene compiles.
