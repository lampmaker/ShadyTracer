// MADE BY scenes/make.mjs -- edit that, and run it, rather than this.
// File › Examples, in order: each example's file, title, who it is for, its group, a line saying what it shows, and
// the camera it opens with (lib/camera.js orbit: azimuth from +x towards +y, elevation from straight up).
export const EXAMPLES = [
 {
  "file": "first-steps.json",
  "title": "First steps",
  "audience": "Modelling and rendering",
  "group": "Start",
  "description": "Shapes on a table in daylight: one glass, two blended into one",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    -20,
    25
   ],
   "azimuth": -60,
   "elevation": 65,
   "distance": 330,
   "dimensions": 330
  }
 },
 {
  "file": "shape-gallery.json",
  "title": "Shape gallery",
  "audience": "Modelling and rendering",
  "group": "Shapes",
  "description": "Every built-in shape, about 50 mm across",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    -10,
    15
   ],
   "azimuth": -90,
   "elevation": 55,
   "distance": 700,
   "dimensions": 700
  }
 },
 {
  "file": "combining-shapes.json",
  "title": "Combining shapes",
  "audience": "Modelling and rendering",
  "group": "Shapes",
  "description": "Union, subtract and intersect, sharp and blended; a die made the way a die is",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    -25,
    15
   ],
   "azimuth": -70,
   "elevation": 60,
   "distance": 420,
   "dimensions": 420
  }
 },
 {
  "file": "modifiers.json",
  "title": "Modifiers",
  "audience": "Modelling and rendering",
  "group": "Shapes",
  "description": "Twist, bend, repeat, mirror, round, shell, displace and relief, each on a plain shape",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    0,
    20
   ],
   "azimuth": -75,
   "elevation": 55,
   "distance": 520,
   "dimensions": 520
  }
 },
 {
  "file": "from-points.json",
  "title": "From points",
  "audience": "Modelling and rendering",
  "group": "Shapes",
  "description": "An extruded star, a turned wine glass, a pipe along a path, a swept bar",
  "camera": {
   "mode": "orbit",
   "target": [
    10,
    0,
    60
   ],
   "azimuth": -80,
   "elevation": 65,
   "distance": 600,
   "dimensions": 600
  }
 },
 {
  "file": "parametric-part.json",
  "title": "Parametric part",
  "audience": "Modelling and rendering",
  "group": "Shapes",
  "description": "A heatsink whose fin count, pitch and height are its parameters",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    0,
    12
   ],
   "azimuth": -60,
   "elevation": 60,
   "distance": 170,
   "dimensions": 170
  }
 },
 {
  "file": "infinite-detail.json",
  "title": "Infinite detail",
  "audience": "Modelling and rendering",
  "group": "Shapes",
  "description": "A Menger sponge four levels deep, and columns repeated to the horizon",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    0,
    1.6
   ],
   "azimuth": -50,
   "elevation": 78,
   "distance": 9,
   "dimensions": 9
  }
 },
 {
  "file": "material-board.json",
  "title": "Material board",
  "audience": "Modelling and rendering",
  "group": "Materials",
  "description": "The library's materials on 40 mm spheres",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    0,
    15
   ],
   "azimuth": -90,
   "elevation": 50,
   "distance": 620,
   "dimensions": 620
  }
 },
 {
  "file": "relief-texture.json",
  "title": "Relief and texture",
  "audience": "Modelling and rendering",
  "group": "Materials",
  "description": "Plaster, stucco, render, stone, hammered metal, leather: reliefs in a raking light",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    -40,
    60
   ],
   "azimuth": -90,
   "elevation": 78,
   "distance": 950,
   "dimensions": 950
  }
 },
 {
  "file": "glass-liquid.json",
  "title": "Glass and liquid",
  "audience": "Modelling and rendering",
  "group": "Materials",
  "description": "A tumbler of water, a green bottle, a flint prism in the sun",
  "camera": {
   "mode": "orbit",
   "target": [
    10,
    0,
    60
   ],
   "azimuth": -110,
   "elevation": 72,
   "distance": 520,
   "dimensions": 520
  }
 },
 {
  "file": "lighting-room.json",
  "title": "Lighting a room",
  "audience": "Modelling and rendering",
  "group": "Light and camera",
  "description": "A room in metres: daylight through a window and a 1500 lm lamp",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    0,
    1
   ],
   "azimuth": -90,
   "elevation": 85,
   "distance": 1.4,
   "dimensions": 4
  }
 },
 {
  "file": "depth-of-field.json",
  "title": "Depth of field",
  "audience": "Modelling and rendering",
  "group": "Light and camera",
  "description": "A row of pawns through an open lens, focused on the third",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    120,
    20
   ],
   "azimuth": -90,
   "elevation": 80,
   "distance": 270,
   "dimensions": 300,
   "aperture": 8,
   "focus": 0
  }
 },
 {
  "file": "animation.json",
  "title": "Animation",
  "audience": "Modelling and rendering",
  "group": "Light and camera",
  "description": "Values marked animated, for the Timeline",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    0,
    30
   ],
   "azimuth": -70,
   "elevation": 65,
   "distance": 300,
   "dimensions": 300
  }
 },
 {
  "file": "product-shot.json",
  "title": "Product shot",
  "audience": "Modelling and rendering",
  "group": "Light and camera",
  "description": "A perfume bottle on a plinth in studio light",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    0,
    95
   ],
   "azimuth": -65,
   "elevation": 78,
   "distance": 380,
   "dimensions": 380
  }
 },
 {
  "file": "led-lens-screen.json",
  "title": "LED, lens and screen",
  "audience": "Optical design",
  "group": "Optical design",
  "description": "An LED, a PMMA lens and a detector: illuminance in lux",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    0,
    120
   ],
   "azimuth": -60,
   "elevation": 75,
   "distance": 450,
   "dimensions": 450
  }
 },
 {
  "file": "aspheric-condenser.json",
  "title": "Aspheric condenser",
  "audience": "Optical design",
  "group": "Optical design",
  "description": "An aspheric lens collimating a small source",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    0,
    100
   ],
   "azimuth": -60,
   "elevation": 75,
   "distance": 500,
   "dimensions": 500
  }
 },
 {
  "file": "fresnel-plano-convex.json",
  "title": "Fresnel or plano-convex",
  "audience": "Optical design",
  "group": "Optical design",
  "description": "One focal length made two ways, side by side",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    0,
    150
   ],
   "azimuth": -70,
   "elevation": 75,
   "distance": 600,
   "dimensions": 600
  }
 },
 {
  "file": "parabolic-reflector.json",
  "title": "Parabolic reflector",
  "audience": "Optical design",
  "group": "Optical design",
  "description": "A torch's reflector: the far field, intensity and beam angle",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    0,
    10
   ],
   "azimuth": -60,
   "elevation": 65,
   "distance": 160,
   "dimensions": 160
  }
 },
 {
  "file": "light-guide.json",
  "title": "Light guide",
  "audience": "Optical design",
  "group": "Optical design",
  "description": "Light carried round two bends by total internal reflection",
  "camera": {
   "mode": "orbit",
   "target": [
    -10,
    15,
    20
   ],
   "azimuth": -50,
   "elevation": 55,
   "distance": 220,
   "dimensions": 220
  }
 },
 {
  "file": "rgbw-mixing.json",
  "title": "RGBW colour mixing",
  "audience": "Optical design",
  "group": "Optical design",
  "description": "Four LEDs and a mixing rod: the colour map",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    0,
    30
   ],
   "azimuth": -60,
   "elevation": 70,
   "distance": 160,
   "dimensions": 160
  }
 },
 {
  "file": "prism-dispersion.json",
  "title": "Dispersion in a prism",
  "audience": "Optical design",
  "group": "Optical design",
  "description": "White light split by a flint prism at minimum deviation",
  "camera": {
   "mode": "orbit",
   "target": [
    30,
    -10,
    0
   ],
   "azimuth": -90,
   "elevation": 5,
   "distance": 260,
   "dimensions": 260
  }
 },
 {
  "file": "dichroic-combiner.json",
  "title": "Dichroic combiner",
  "audience": "Optical design",
  "group": "Optical design",
  "description": "Red and blue beams joined by a coated plate",
  "camera": {
   "mode": "orbit",
   "target": [
    10,
    0,
    30
   ],
   "azimuth": -90,
   "elevation": 65,
   "distance": 330,
   "dimensions": 330
  }
 },
 {
  "file": "office-lighting.json",
  "title": "Office lighting",
  "audience": "Optical design",
  "group": "Optical design",
  "description": "Four LED panels and the work plane's illuminance",
  "camera": {
   "mode": "orbit",
   "target": [
    0,
    0,
    1
   ],
   "azimuth": -90,
   "elevation": 70,
   "distance": 2.5,
   "dimensions": 6
  }
 }
]
