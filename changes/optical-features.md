bump: minor

**Each scene chooses its optics: dispersion, absorption inside and coatings.** The scene's row in the tree has a new
box, *optical features*. It has a switch for each of the three, and **Basic** (all off) and **Full** (all on) above
them. A mix of the two reads Custom.
- **A feature off is not traced at all,** in the picture or on the Optics page. The scene is compiled as if no
  material had those fields: byte for byte the shader of the same scene without the values.
- **Its fields are not shown** on any material, in the Parameters panel or on the timeline. With dispersion off there
  is no Abbe number, with absorption off no colour depth, with coatings off no coating box.
- **The values are kept,** and come back when the feature is on. The box says which materials have a value it hides,
  for instance a library glass's Abbe number in a Basic scene.
- **Each change is a compile and one undo step.**
- **Full is the default** for a new scene, every example and every older file, so no picture changes until you
  choose.

**Dispersion is no longer a render setting.** Its row in Render settings › Paths and noise (0.74.0) is gone, Quality's
Standard and High no longer touch it, and switching it is now a compile rather than live, as you chose. A project
whose renderer had it off opens with dispersion off in each of its scenes. The Optics page now follows the scene
instead of always tracing dispersion. The scene file's version does not change: an older build opening a newer file
ignores the box and traces every feature. `builder/materials.js` FEATURES, `builder/model.js` setFeatures,
`builder/panel.js` featuresFolder; `roadmap/LIGHT_MODEL.md` step S0a.

**What to look at:**
- **Open the example *Dispersion in a prism*.** On the scene's row, in *optical features*, press **Basic**. After the
  compile the prism's fan of colours should be gone, every glass bending all colours alike. The flint's material
  should show no Abbe number, colour depth or coating box, and the box should say the flint has an Abbe number it is
  keeping.
- **Tick dispersion alone:** the fan comes back and the box reads Custom.
- **Press Full:** everything is as it was.
- **Then the Optics page with dispersion off:** a prism's exit angles should be the same for every colour.
- **How long a switch takes to compile on your card.**
