# PW1100G-JM cutaway reducer

`lib/gear.ts` draws an illustrative first-stage planetary reducer in SI units.
The values are chosen to make the browser cutaway mechanically coherent; they
are not claimed to be the factory PW1100G-JM tooth counts or a manufacturing
drawing.

| item                                    |        value |
| --------------------------------------- | -----------: |
| sun / star / ring teeth                 | 30 / 30 / 90 |
| equal star count                        |            5 |
| transverse module                       |     0.0045 m |
| transverse pressure angle               |       20 deg |
| helix angle per half                    |       20 deg |
| total face width                        |      0.060 m |
| central relief                          |      0.006 m |
| circular backlash (ideal rigid contact) |          0 m |

The model uses the engineering-plan convention: the shaft axis is `+X` and
the radial plane is `YZ`; positive angles follow the right-hand rule about
`+X`. The sun is the LP input, the carrier is fixed, and the ring carries the
fan-side output flange. The pitch radii are 0.0675 m, 0.0675 m, and 0.2025 m,
so the sun-star and star-ring centre distances are both 0.135 m. The exact
ratio is 3:1 for this illustrative tooth selection.

`createGearbox()` uses `contactMode = "zero-backlash-ideal-rigid-contact"` and
builds its actual profiles with `GEAR.backlash = 0`. This is an idealized
kinematic constraint, not a manufacturing tolerance or loaded elastic contact model.
The mesh profile uses 16 samples per involute flank, 4 across each tip land,
and 4 across each root land. Tests allow at most 0.00002 m of Float32/chord
error at a contact boundary and sample every star, helix side, axial slice,
and an incommensurate full-cycle angle set.

`gearProfile(teeth, internal, options)` returns a cyclic `THREE.Vector2[]` in
`(Y,Z)` coordinates. External teeth use an involute flank whose angular
half-thickness narrows with radius. The internal ring uses the true internal
relation

```text
halfThickness(r) = pi/(2Z) - backlash/(2rp) - inv(alpha0) + inv(alpha(r))
```

and therefore grows toward the ring root. The polygon is implicitly closed;
the final point is joined back to the first point.

Root lands and transitions are sampled polygonal reliefs rather than a
manufacturing trochoidal fillet. Increasing the profile sample options makes
the visual flank smoother; the helix is likewise a procedural axial phase
twist suitable for the cutaway display.

Each gear is a double helix with an un-toothed central relief. The sun uses
helix sign `+1`; the stars and internal ring use `-1`. Thus the sun/star
external pair has opposing handedness while the star/ring internal pair has
matching handedness. For each half, `geometry.userData.helixSlope` records the
actual sign used to twist the generated profile along `X`.

The common angular coordinate is exposed by `deriveGearAngles(lpAngle)`:

```text
sun   = lpAngle
star  = -(Zs/Zp) * lpAngle + pi/Zp
ring  = -(Zs/Zr) * lpAngle
```

The star's half-tooth phase places a gap on each sun contact line at
`lpAngle=0`; the ring's zero phase is the complementary internal-mesh phase.
These phases select the ideal rigid contact flanks. The polygonized mesh can
deviate from its analytic involutes only by the bounded chord/tessellation
error checked in `tests/gear.test.ts` as the common coordinate advances.
`(Zs + Zr) / 5` and `(Zs + Zp) / 5` are integers, so the same phase relation
works for all five equal orbit positions. `createGearbox().setAngle()` updates
the sun, every star, and the ring from that one LP angle; the carrier and its
journal pins remain fixed.

The sun has a 0.040 m bore and a 0.035 m LP input shaft joined by an annular
spline sleeve. Each star has a 0.014 m bore, a 0.0085 m fixed journal pin,
and a rotating annular journal sleeve. The open carrier uses five radial
spokes, hub and journal annuli, and fixed pins so its support path remains
visible in a front cutaway. Its thin aft support plate is at local X=+0.036 m
(world X≈+0.636 m after the viewer translation); the pins extend through the
star bores to that plate. This keeps stationary carrier metal clear of the
ring's rotating output drum. The ring output drum and 0.055 m shaft extend on
the negative-X side to meet the fan shaft; these interface sizes are visual
assembly choices for this illustrative model.

The profile and mesh checks intentionally test normal contact velocity at the
pitch point and along the line of action in the same zero-backlash rigid mode
used by the default model. For every star, both helical hands, every axial
slice, and an incommensurate full-cycle set of LP angles, the tests construct
the external-sun and internal-ring involute LOA candidates and measure each
candidate against both actual mating mesh polygons. The generated mesh chords
must stay within 0.00002 m of a common analytic mating contact point and must
not cross into the opposing solid. Flank sliding away from the pitch point is
expected involute gearing and is not treated as a mesh failure.
