bump: minor

**A coating on a metal now does something.** Before this, a metal's reflection never read the material's coating, so a
dichroic, a beam splitter or an anti-reflective layer on a material with metallic 1 changed nothing. A material that
was part metal had the coating only on its non-metal share. Now the stack lies over the metal. The coating reflects
its R, and what it passes reaches the metal, which reflects its own share back out through the coating. Every bounce
between the two is added as an intensity, which comes to 1 - (1 - R)(1 - F) / (1 - R F), with F the metal's Schlick
Fresnel (`core/materials_pbr.js` `metalFresnel`). The result is never less than the coating or the metal alone. A white
metal stays white, an AR layer leaves a metal as it was, and a full mirror coating makes a mirror. Turquin's energy
compensation takes its F0 from the same sum at normal incidence. An uncoated metal is the same code as before, bit for
bit. The light sampling, the photons, the photon map and the Optics trace (colour and by wavelength) all build the same
lobes, so they all see the change. Two approximations, both stated in the code: as on glass, R is the coating's at the
view's angle for every facet; and the metal's F is its reflectance in air, while a real metal under a dielectric layer
reflects somewhat less. `coating.gpu.mjs` gains eleven rows on Dawn. Smooth metals under a dichroic, a beam splitter,
an AR layer and every face are held to the bounces summed term by term. Rough metals, coated and not, are checked to be
sampled as they are evaluated. With the old metal lobe put back, the six rows that should change fail. The help's
Coatings section, the coating field's help and the panel's tooltip say what a coating does on a metal. The tutorial's
microfacets chapter cites the changed lines.

**What to look at:** a sphere with metallic 1, roughness about 0.05 and a dark grey colour (0.2 to 0.3), with the
coating "dichroic: reflects red". It should reflect its surroundings red-tinted: red near full, green and blue at the
grey metal's level, and toward orange or yellow near the rim, where the edge moves. Next, the same with a white or
silver colour: it should look almost unchanged (that is the physics: a bright metal already reflects what the coating
passes). Then a gold colour with "dichroic: reflects blue": gold with a blue sheen. An uncoated metal should look
exactly as before. The speed of an uncoated metal should not change, since it runs the same code. A coated metal adds a
few multiplies a reflection. This is unmeasured.
