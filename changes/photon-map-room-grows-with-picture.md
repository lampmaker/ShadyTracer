bump: patch

**The photon map's room grows with the picture, so a large save is no darker than a small one.** The map held a fixed
number of photons (the setting *Photon map: photons*, 2 million by default) whatever the picture's size. A larger
picture sends more photons, one a pixel by default, and the map's gather radius is in pixels, so its disc shrinks too:
at 3840 x 2160 the map kept 21% of its stores (1,700,191 kept, nothing dropped, no gather cut) where 1920 x 1080 kept
about 85%, and each gather found far fewer photons. A 4K save in the Optics view came out visibly darker than the same
scene at 1080p, and right with the setting raised to 16. The keep is exact on average, so the darkening is inferred to be
the noise it brings: bright pixels clip at white and give back less than they took. Now the setting is the room for a
1920 x 1080 picture and a larger one gets room in proportion: 8 million at 4K by default, 352 MB, capped by what one GPU
buffer may hold. Below 1920 x 1080 nothing changes. The room grows as a panel is dragged larger and is given back after
a save larger than the view; Save an image's memory estimate counts it.

**What to look at:** save the same scene at 1920 x 1080 and 3840 x 2160 with the photon map at its default 2 and the same
develop settings: the two should now match in brightness, as they did with 16. Render stats' photon-map line during a 4K
render should say a share near 1080p's rather than 0.21. A large live view (above 1920 x 1080) also gets the larger map:
say if its memory is a problem.
