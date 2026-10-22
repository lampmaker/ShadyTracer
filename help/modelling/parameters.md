# Parameters and code

Every shape in ShadyTracer is a small piece of code with **parameters**: a sphere's radius, a box's size. You can
change the numbers, add parameters of your own, drive one from another, or rewrite the code.

## Parameters

In an object's or group's Properties, each parameter is a row: a number, a vector (x, y, z) or a colour. **+** in
the parameters header adds one. Each parameter can be:

- **live** (the usual): a slider moves the picture with no compile;
- **compile-time**: built into the program, for a number the code must know before it runs, such as a loop's count.
  The Menger sponge's depth in [Infinite detail](example:infinite-detail.json) is one;
- **a length**: shown in the scene's unit, and converted with it when the unit changes and the dimensions are
  converted ([Numbers are in the scene's unit](vs-cad.md#numbers-are-in-the-scenes-unit));
- given a **range**, which its slider keeps to.

Every setting in the program, the renderer's included, also has a path, such as `scene/<id>/radius`. The
[Parameters panel](show:parameters) lists them all, and **Ctrl K** finds one by name. Typing `exposure = 2` there
sets it.

## Component parameters

A group can have parameters, and what it holds can be **bound** to them. That makes the group a component:
change its few numbers, and everything inside follows. In a child's Properties, the bindings are lines of
`target = expression`:

```
size.x = fins * pitch / 2
pos.z = base + finHeight / 2
copies.count = fins
copies.pitch = pitch
copies.along = x
```

A target is one of the child's parameters (or one part of a vector, `size.x`), its position or rotation
(`pos.x`, `rot.z`, `scale`), a group's `blend`, or an array's `copies.count`, `copies.pitch` and `copies.along`. An
expression uses numbers, `+ - * /`, brackets, and the names of parameters of the groups above. A vector parameter
is read one part at a time (`corner.x`), and a colour the same way (`tint.r`, `tint.g`, `tint.b`). A name that no
group above has is reported, never guessed.

A whole vector or colour can be bound in one line, to a parameter of the same kind: `pos = at` or
`light.colour = tint`. It is kept as one line for each part.

**A light** can also bind its own settings, written `light.` and the setting: `light.flux`, `light.luminance`,
`light.colour` (or `.r`, `.g`, `.b`), `light.cct`, `light.duv`, `light.xy.x`, `light.xy.y`, `light.n`,
`light.halfAngle` and `light.emitN`. A lamp component could look like this:

```
light.flux = flux
light.colour = tint
width = size
```

A light setting also sets how the light is given. `light.flux` makes the light set by its flux, `light.luminance`
by its luminance, `light.colour` coloured by RGB, `light.cct` by CCT. While it is bound, the matching *brightness
by* or *colour by* row is held, so you cannot bind both `light.flux` and `light.luminance`. A value the light
cannot take, such as a CCT out of range, is reported and the light keeps its last value.

Some things cannot be bound:
- **A material's fields.** A material is shared by every object that wears it, so one object cannot change its
  colour alone. To give each copy of a component its own colour, give each its own material.
- **A haze box or an export box.** Neither has a *from parameters* box.
- **A light's choices:** its distribution, *both faces* and *transparent*.

[Parametric part](example:parametric-part.json) is a heatsink built this way: change `fins` in its Properties.

## Arrays

A plain group can have **copies**: a list of places where everything in it is drawn again. A row or a ring of
copies is made in its Properties; bound to parameters as above, a row's count and spacing follow them. A copy is a
place to draw the same shapes again, not a new shape: its position is a live value.

**A light inside an array** is a light at every copy: a strip of LEDs is one LED in a row of copies, a ring of them
one in a ring. Each copy is a whole light, with the light's own settings and its own flux: a 10 lm light in 12
copies is 120 lm. Two rules:
- The copies of an array with a light in it share **one scale**. A copy may move and turn freely.
- An array with a light in it is not put **inside a group whose children join** (a subtraction, an intersection, a
  blend). Such a light is not drawn, and the Optics page lists it as skipped, with the reason. Put the array outside
  the joining group.

The *circular array* modifier is group code, and draws no light. Use a ring of copies instead. With a ring radius
of 0, the copies turn about the group's axis as the circular array's do.

## Writing code

Any object, group or material can be rewritten in **WGSL**, the graphics card's language. Open its *code* box in
Properties. A probe compile runs half a second after you stop typing and shows any error **at your own line**.
**Ctrl Enter** applies.

- **An object's code** adds a shape: `C = add_new(C, Nsphere(p, radius), MATERIAL);` where `p` is the point in the
  object's own frame and your parameters are names.
- **A group's code** changes the space its children are drawn in, then calls them: `C = children(C, p);`. Every
  modifier is a group with code, so open one to see how it is done.
- **A material's code** runs where a ray hits, after its fields are set. It can change `m.baseColor`,
  `m.roughness` and the rest from the hit point: a checker, a stripe, a grain.
- **The scene's functions** (in the scene's Properties) are helpers any code in the scene can call.

The [Shapes](../reference/shapes.md) and [Modifiers](../reference/modifiers.md) references show what each built-in
one does. Their code is the place to start.

> A shape's code runs at every step of every ray -- hundreds of times per ray -- so keep it short. A material's code
> runs about once per bounce, where the ray hits, and costs far less.
