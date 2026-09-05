# PW1100G-JM procedural cutaway

`createEngineGeometry()` in [`lib/engine-geometry.ts`](../lib/engine-geometry.ts)
builds a closed, selectable Three.js model in SI metres. The engine axis is
`+X` from fan to exhaust; `Y/Z` are radial and positive rotation is about
`+X`. The result has five groups:

```ts
{
  (group,
    fan,
    lp,
    hp,
    stationary,
    casing,
    selectables,
    parts,
    stages,
    rotorStages,
    stageCounts,
    velocityTriangles,
    workConsistency,
    flowPath,
    caseProfile,
    flowShroudProfile,
    metadata,
    setAngles(lpAngle, hpAngle));
}
```

Every selectable object and every mesh has `userData.partId`. The matching
`PartInfo` record contains `id`, `name`, `description`, `x`, and, when useful,
`source` and `approximation`. Repeated blades additionally expose
`userData.stageId`, `userData.bladeIndex`, `userData.pitch`, and a role such as
`rotor-blade`, `rotor-disk`, `stator-vane`, or `fixed-support-frame`.

## Architecture and stations

The stage topology follows the public PW1100G-JM arrangement
`1 fan – 3 LPC – 8 HPC – annular combustor – 2 HPT – 3 LPT`.

| subsystem           | axial span (m) |                        illustrative rows |
| ------------------- | -------------: | ---------------------------------------: |
| fan                 |     `x = 0.20` |   20 swept blades, 2.0574 m tip diameter |
| reduction interface |    `0.55–0.60` | reserved for the separate reducer module |
| LPC                 |    `0.92–1.25` |          3 LP rotor rows and stator rows |
| HPC                 |    `1.40–2.00` |          8 HP rotor rows and stator rows |
| combustor           |    `2.10–2.42` |   inner/outer liners, dome, 12 injectors |
| HPT                 |    `2.50–2.67` |           2 HP turbine rotor/nozzle rows |
| LPT                 |    `2.80–3.25` |           3 LP turbine rotor/nozzle rows |

The fan output shaft occupies `0.20–0.55` and the LP inner shaft occupies
`0.58–3.25` at a 35 mm radius. They intentionally remain separate at the
gearbox boundary: the fan/ring output and LP/sun input are connected by the
separate reducer implementation. The HP shaft is a closed annulus from
`1.40–2.68` with a 60 mm bore and 95 mm outside radius.

Each rotor row contains a closed multi-section airfoil, a disk/web and a hub.
The airfoil uses a cambered NACA-like section with radial stagger interpolation,
axial sweep, and thickness. Stator rows have closed inner and outer platforms;
front structural guide vanes, four bearing frames, and radial case supports
complete the stationary load paths. The combustor uses tapered annular shells
for the dome and liners, plus closed radial injector bodies.

The dark case is made from closed annular solids. The fan case reaches an outer
radius of `1.112 m` (2.224 m diameter). The core case contracts through the
compressors and opens through the turbine. A thin inner core flow shroud follows
the actual `CORE_FLOW_PATH` tip envelope with a `10 mm` rotor tip clearance and
`12 mm` wall. Its axial envelope also covers the swept rotor rows; the
structural core case remains outside that shroud and carries the stator
supports. A transparent bypass envelope is a visualization surface, not a
certified nacelle or nozzle model.

## Flow path and kinematics

`CORE_FLOW_PATH`, `BYPASS_FLOW_PATH`, and combined `FLOW_PATH` are exported for
the flow tracer and physics worker. Each point has `{stream, x, hub, tip,
hubRadius, tipRadius, area, stageId?}`; `area` is the annulus area in m².
Points carrying `stationId` also carry the matching fixed-cycle `physicsArea`;
the geometric `area` at those continuity stations is generated from the same
annulus value. Points are monotonic in `x` within each stream. The bypass hub
stays outside the core-case outer wall after the splitter, and its 2 m² nozzle
annulus is physically represented by the thin outer casing. The exported
`CORE_FLOW_SHROUD_PROFILE` is the continuous physical core gas-path wall: its
inner radius is `flowTip + 0.010 m` at flow stations, and its axial envelope
holds the nearby rotor row tip while its outer radius adds `0.012 m`; the
structural case is checked outside that wall. `BYPASS_CASE_PROFILE.inner` is
exactly the interpolated bypass flow tip; its outer radius adds a `0.06 m` wall.
The fixed-cycle station `area` values describe the fluid annuli used by
`physics.ts`; the small core tip clearance means the solid shroud's inner
surface is intentionally just outside those reference streamlines.

`stages` contains one record for each rotor row, with exact stage counts and
the row span/radii. Every stage has three `velocityTriangles` samples at hub,
mid-span and tip. Each stage also exposes `specificWork` and `stageLoading`,
calibrated from the nominal physics cycle. For each sample:

```text
omega = rpm · 2π / 60
U     = omega · radius
W_E   = U · |Vθ,out − Vθ,in|
```

The sign of `Vθ` is reversed for turbine work so `eulerWork` is positive
magnitude for both compressor and turbine rows. `rotorStagger` is derived
from relative inlet/outlet flow angles and `statorStagger` from absolute
angles. The design-point angle means are applied directly to the generated
illustrative airfoil, without a ±1.15 rad display clamp; high-loading
compressor rows can therefore exceed that range. The local +theta direction
follows blade motion: fan rotor and guide-vane stagger/camber are mirrored
into world coordinates because the ring/fan turns opposite to LP. Rotor web/hub, stator
platform, and core-row chord spans are allocated inside each fixed axial
pitch so the generated mesh x/r envelopes remain separated. That is a
conservative mesh-layout check, not a blade-clearance or aerodynamic
certification. `workConsistency` exposes per-stage and total Euler/expected
work residuals; the generated model keeps those residuals at floating-point
zero.

The shared nominal point is throttle `0.7`. `GEOMETRY_DESIGN_POINT` evaluates
`createEngine(0.7)` once and copies its solved LP, HP, fan/ring speeds, station
axial velocities, and per-row family work values; `metadata.designPoint`
exposes the same object. This keeps the rotor triangle calibration on the
same steady cycle used by the flow tracer instead of duplicating a separate
speed or compressor work target in the renderer. Compressor rows use their
cycle specific work directly. Turbine rows use the gas-side specific enthalpy
drop between the combustor, HPT exit, and LPT exit stations, divided across
their illustrative row counts; `hptPower` and `lptPower` are shaft outputs
after mechanical efficiency and are therefore not used for turbine blade
Euler work. The inferred nominal gas heat capacity and combined turbine drops
are exposed as `metadata.designPoint.gasSpecificHeat` and
`metadata.designPoint.turbineEnthalpyDrop`.
`setAngles(lpAngle, hpAngle)` applies the LP and HP rotations and derives the
fan phase as `-lpAngle / 3`, preserving the reducer ratio at mesh level while
leaving gear teeth and carrier geometry to the reducer module.

The core case profile is exported as `CORE_CASE_PROFILE` and returned as
`caseProfile`; `coreCaseInnerRadiusAt(x)` and `coreCaseOuterRadiusAt(x)` define
the structural support envelope. `CORE_FLOW_SHROUD_PROFILE` is returned as
`flowShroudProfile`, with matching `coreFlowShroudInnerRadiusAt(x)` and
`coreFlowShroudOuterRadiusAt(x)` helpers used for rotor and stator tip
clearance. `BYPASS_CASE_PROFILE` and `bypassCaseInnerRadiusAt(x)` are generated
from the bypass path tip with an exact flow-side inner boundary and a fixed
wall thickness. Rotor tips and stator shrouds keep a measured clearance to the
corresponding physical flow wall, while radial support struts bridge that wall
to the structural case. The bypass envelope is a thin outer nacelle wall, so
it does not fill the bypass stream with solid material.

## Sources and limits

The architecture, fan diameter, and source context are based on:

- [Pratt & Whitney PW1100G-JM product card](https://prd-sc102-cdn.rtx.com/prattwhitney/-/media/pw/newsroom/collateral/documents/commercial-engines/pw_gtf_pc_pw1100g-jm.pdf)
- [IHI Technical Report 53-4](https://www.ihi.co.jp/technology/techinfo/contents_no/__icsFiles/afieldfile/2023/06/16/dfa646fceb7705a3c159683b20eb8b2b.pdf)
- [EASA PW1100G-JM TCDS](https://www.easa.europa.eu/en/document-library/type-certificates/engine-cs-e/easaime093-pw1100g-jm-series-engines)

Blade counts, detailed airfoil sections, pitch, clearances, bearing internals,
cooling holes, casing split lines, bypass nacelle, and nozzle shape are
illustrative. The model is a mechanically connected visual and kinematic
cutaway; it does not claim proprietary manufacturing fidelity, CFD/FEM
accuracy, surge behavior, or certified operating limits.
