# Browser lab physics

`lib/physics.ts` is a deterministic, bounded, simplified 1-D separate-flow
turbofan cycle. SI units are used internally. Every map, dimension, loss and
inertia is an illustrative control for the browser lab; this is not a
PW1100G-JM performance map and does not promise real-engine performance.

The component sequence is one fan acting on the combined inlet flow, a
three-stage LPC and eight-stage HPC in the core, an annular combustor, two HPT
stages and three LPT stages. The bypass and core streams remain separate after
the fan. Fuel is added to the core gas stream after the combustor.

## Cycle and flow closure

Ambient input is static pressure, static temperature and axial velocity. The
cycle derives the inlet ram total state from the ambient Mach number. Each
compressor uses its illustrative pressure-ratio map and isentropic efficiency;
the combustor applies pressure recovery and fuel energy; each turbine uses a
pressure-ratio map and turbine efficiency.

The air and hot-gas constants satisfy `cp = gamma × R / (gamma − 1)` so the
static enthalpy plus kinetic energy at a nozzle exit is consistent with its
total state.

The fixed flow areas are exported as `FLOW_PATH_AREAS` (m²): inlet `3.3`, fan
exit `3.2`, core split `0.32`, LPC exit `0.24`, HPC exit `0.12`, combustor
`0.11`, HPT exit `0.10`, LPT exit `0.22`, core nozzle `0.18`, and bypass nozzle
`2.0`. They are fixed geometry values for this illustrative lab. In
particular, nozzle areas are never recomputed from a requested flow.
The matching axial coordinates are exported as `FLOW_PATH_STATION_X`.

For every station, total temperature and pressure are converted to static
values. A subsonic Mach number is found by bisection until

```text
massFlow = density(static T, static P) × velocity(static T, Mach) × area
```

The returned `continuityMassFlow` is calculated again from the returned static
state. If a fixed non-nozzle flow path has no subsonic solution, evaluation
throws instead of hiding the mismatch at Mach 1. A convergent nozzle uses its
fixed area and the compressible mass-flux equation; it reports whether the
critical pressure ratio chokes it, along with exit velocity and pressure
thrust. `NozzleResult.totalEnergyResidual` independently checks
`cp × staticTemperature + velocity² / 2` against `cp × Tt`.

`CycleResult.massResidual` independently recomputes every station's
`density × velocity × area` and also checks the core/bypass split and fuel
addition. `powerResidual` is the normalized absolute HP and LP shaft power
imbalance. `energyResidual` checks the total energy balance including fuel,
compressor/turbine losses, bearing and gearbox dissipation, and instantaneous
shaft kinetic storage power.

Stations use the following axial locations so the flow records line up with
the cutaway geometry: inlet `0.00`, fan `0.20`, core split `0.55`, LPC exit
`1.18`, HPC exit `1.95`, combustor exit `2.42`, HPT exit `2.64`, LPT exit
`3.14`, core nozzle `3.32`, and bypass nozzle `3.25` m.
Each record has `stream: "core" | "bypass" | "common"`, total `Tt`/`Pt`,
static temperature/pressure, density, Mach, velocity, area, requested mass
flow and independently recomputed continuity flow.

## Rotor dynamics

The fixed-carrier reducer uses a 3:1 illustrative speed ratio and a 0.993
representative gearbox efficiency. The efficiency is an approximation, not a
claim about an exact PW1100G-JM gearbox. The LP inertia includes the LP rotor,
the fan/ring reflected through the square of the ratio, and five illustrative
star inertias. HP and LP speeds are integrated separately from turbine power
minus their compressor, fan/gear and bearing loads:

```text
I_lp × d(lpOmega)/dt = lpNetPower / lpOmega
I_hp × d(hpOmega)/dt = hpNetPower / hpOmega
```

`lpAngle` and `hpAngle` are integrated in radians. The fan angle is derived
from the LP angle with the opposite sign convention used by the gearbox
visualization. A throttle change therefore produces a real transient surplus
or deficit; RPM is not interpolated or forced to a fixed HP/LP ratio.
`advanceEngine` uses an explicit midpoint (second-order Runge–Kutta) update:
it evaluates the component cycle at the predicted midpoint rotor speeds and
uses those midpoint powers for the full substep.

## Public API

```ts
createEngine(throttle?: number): EngineState
advanceEngine(state: EngineState, throttle: number, dtSeconds: number): EngineState
getDiagnostics(state: EngineState): EngineDiagnostics
evaluateCycle(inputs?: CycleInputs): CycleResult
evaluateCycle(lpOmega, hpOmega, throttle, ambient?): CycleResult
```

`createEngine` solves both shaft power residuals for a steady running point.
The published steady envelope is `PHYSICS_LIMITS.minRunningThrottle` (`0.1`)
through `maxRunningThrottle` (`1.0`), with LP speed `160..1320` rad/s and HP
speed `300..2200` rad/s. A steady point below the minimum has no converged root
in this model and throws. `advanceEngine` accepts a bounded throttle command
in `[0, 1]`, uses midpoint-RK2 substeps no larger than `0.02` s, and throws if
the requested transient leaves the speed envelope. It does not model startup,
shutdown, FADEC scheduling, surge, variable geometry, heat soak, CFD,
structural loads or certified limits.

`advanceEngine` returns a new state and leaves its input unchanged. The state
exposes `time`, `lpOmega`, `hpOmega`, `lpAngle`, `hpAngle`, `throttle` and
`cycle`. The cycle contains stream flows including fuel, thrust, fan/LPC/HPC/
HPT/LPT powers, gearbox loss, normalized mass and power residuals, turbine
inlet temperature, all station records, and core/bypass nozzle details.

The architecture and broad component arrangement are guided by the public
references listed in `ENGINEERING_PLAN.md`. The numerical maps, areas,
efficiencies, inertias and losses here remain explicitly synthetic.
