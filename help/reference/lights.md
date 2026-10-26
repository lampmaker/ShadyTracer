# Light settings

> Made by `help/reference.mjs` from the program's own lists: edit that, not this page.

A light object is a flat rectangle or disc that emits from its front (+z), or a ray file's rays. Its size is its parameters; the rest is here. *rectangle light*, *disc light*, *ray file*. Inside an array (a group's copies), it is a light at every copy, each with these settings: see [Arrays](../modelling/parameters.md#arrays).

| setting | starts at | does |
|---|---|---|
| colourBy | rgb | How the colour is given: as RGB, as a colour temperature (CCT, kelvin, with Duv), or as a CIE 1931 xy chromaticity -- as a datasheet gives it. |
| colour | 1, 1, 1 | The light's colour as linear RGB. Only its hue counts. |
| cct | 4000 | The colour temperature in kelvin: 2700 a warm lamp, 4000 neutral, 6500 daylight. |
| duv | 0 | How far the colour is from the black-body line: 0 on it, positive greener, negative pinker. |
| xy | 0.3127, 0.329 | The CIE 1931 chromaticity, as an LED datasheet gives it. |
| luminance | 1000 | How bright the face is, in cd/m², straight out of it. Set this or the flux: the other follows from the face's area. |
| flux | (not set) | The light's total output in lumens. When set, the luminance follows from it and the face's area, so resizing the face keeps the lumens. |
| distribution | cosine | How the light leaves the face: cosine (cos^n -- n 1 is a Lambertian, an LED or a diffuser), uniform (the same in every direction), or collimated (one direction: a laser, or a beam from far away). |
| n | 1 | The cosine distribution's exponent: 1 Lambertian, higher a narrower beam. |
| halfAngle | 90 | The cone the light is limited to, in degrees from the face's axis: 90 the whole hemisphere. |
| twoSided | false | Both faces emit; otherwise only the front (+z), and the back is black. |
| transparent | false | Light and the camera pass through the face, which glows over what is behind it -- a sheet of light rather than a lamp's body. |
| emitN | 1 | The index of what the face emits into: 1 in air, about 1.41 for an LED die in silicone. It changes how the light refracts as it leaves. |
