bump: patch

**Dichroics' plates are named by their coatings.** Five of the seven plates in the Dichroics example were labelled with
a wavelength their material did not have (`650 nm [6,2]` wore the 470 nm dichroic, for one): each label's wavelength is
now its material's edge -- 680, 470, 520, 480 and 620 nm -- with its grid place `[r,c]` kept. Nothing but the labels
changed; the shaders are byte for byte what they were.

**What to look at:** File › Examples › Dichroics, the tree under *mirror grid 7x7*: each plate's name is the edge of the
material shown when it is selected.
