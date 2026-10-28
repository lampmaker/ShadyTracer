bump: minor

**Pick focus: the lens focused on what is under the mouse.** The Camera popover (⌖▾) has a *Pick focus* button
under the lens's numbers. Clicked, the popover closes and the cursor becomes a cross over the picture; a press on the
picture focuses the lens on the surface under it -- the focus plane is put through the picked point, so it is sharp
wherever it is in the picture -- and while the button is held the focus follows the mouse over the surfaces. Let go,
it stays focused there and the mode is over. The press is the focus's alone: the camera does not turn, nothing is
selected, no measuring pin is placed. A press on the sky leaves the focus as it was; Esc or a press anywhere else
cancels. The button is there only for a perspective camera (an orthographic one has no lens).
`lib/pathtracer/focuspick.js`; headless-checked by `lib/pathtracer/test/focuspick.check.mjs`.

**What to look at:** a scene with depth, *Depth of field* for one, with the aperture above 0 (focus has no visible
effect at 0). ⌖▾ › *Pick focus*, then press on a near pawn, drag to a far one and back while holding, and let go:
the sharp band should follow the mouse and stay where it was released. Then check a plain drag orbits as before, and
that with the Measure tool's pin or ruler on, the focus press placed no pin.
