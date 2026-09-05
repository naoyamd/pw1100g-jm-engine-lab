/**
 * Deterministic, illustrative 1-D separate-flow turbofan cycle.
 *
 * The maps and dimensions are controls for the browser lab. They are not a
 * PW1100G-JM performance map and must not be used as an engine prediction.
 */

const PI2 = 2 * Math.PI;
const AIR_GAMMA = 1.4;
const GAS_GAMMA = 1.33;
const AIR_R = 287.05;
const GAS_R = 287.05;
const CP_AIR = (AIR_GAMMA * AIR_R) / (AIR_GAMMA - 1);
const CP_GAS = (GAS_GAMMA * GAS_R) / (GAS_GAMMA - 1);
const FUEL_LHV = 43e6;

const DESIGN_LP_OMEGA = 900;
const DESIGN_HP_OMEGA = 1500;
const MIN_LP_OMEGA = 160;
const MAX_LP_OMEGA = 1320;
const MIN_HP_OMEGA = 300;
const MAX_HP_OMEGA = 2200;

const GEAR_RATIO = 3;
const GEAR_EFFICIENCY = 0.993;
const COMBUSTOR_EFFICIENCY = 0.99;
const COMBUSTOR_PRESSURE_RECOVERY = 0.96;
const TURBINE_EFFICIENCY = 0.91;
const TURBINE_MECHANICAL_EFFICIENCY = 0.98;

// Illustrative inertias. The fan/ring is reflected through the reducer ratio;
// five fixed-carrier stars spin at sun speed in this simplified kinematics.
const LP_ROTOR_INERTIA = 8;
const FAN_INERTIA = 110;
const STAR_INERTIA_EACH = 0.26;
const LP_INERTIA =
  LP_ROTOR_INERTIA + FAN_INERTIA / GEAR_RATIO ** 2 + 5 * STAR_INERTIA_EACH;
const HP_INERTIA = 4;

const MAX_FUEL_TO_AIR = 0.08;
const MIN_RUNNING_THROTTLE = 0.1;
const MAX_ADVANCE_SECONDS = 5;
const MAX_SUBSTEP_SECONDS = 0.02;

// Fixed flow-path areas are deliberately exposed so geometry and physics can
// use the same continuity locations. Nozzle areas stay fixed at run time.
export const FLOW_PATH_AREAS = Object.freeze({
  inlet: 3.3,
  fanExit: 3.2,
  coreSplit: 0.32,
  lpcExit: 0.24,
  hpcExit: 0.12,
  combustor: 0.11,
  hptExit: 0.1,
  lptExit: 0.22,
  coreNozzle: 0.18,
  bypassNozzle: 2.0,
});

export const FLOW_PATH_STATION_X = Object.freeze({
  inlet: 0,
  fanExit: 0.2,
  coreSplit: 0.55,
  lpcExit: 1.18,
  hpcExit: 1.95,
  combustorExit: 2.42,
  hptExit: 2.64,
  lptExit: 3.14,
  coreNozzle: 3.32,
  bypassNozzle: 3.25,
});

export const ENGINEERING_PARAMETERS = Object.freeze({
  gearRatio: GEAR_RATIO,
  gearEfficiency: GEAR_EFFICIENCY,
  lpInertia: LP_INERTIA,
  hpInertia: HP_INERTIA,
  fanStages: 1,
  lpcStages: 3,
  hpcStages: 8,
  hptStages: 2,
  lptStages: 3,
  coreNozzleArea: FLOW_PATH_AREAS.coreNozzle,
  bypassNozzleArea: FLOW_PATH_AREAS.bypassNozzle,
});

export const PHYSICS_LIMITS = Object.freeze({
  minThrottle: 0,
  maxThrottle: 1,
  minRunningThrottle: MIN_RUNNING_THROTTLE,
  maxRunningThrottle: 1,
  minLpOmega: MIN_LP_OMEGA,
  maxLpOmega: MAX_LP_OMEGA,
  minHpOmega: MIN_HP_OMEGA,
  maxHpOmega: MAX_HP_OMEGA,
  maxAdvanceSeconds: MAX_ADVANCE_SECONDS,
  gearRatio: GEAR_RATIO,
});

export interface AmbientState {
  /** Static ambient values; ram total state is derived internally. */
  pressure: number;
  temperature: number;
  velocity: number;
}

export type StationStream = "core" | "bypass" | "common";

export interface Station {
  id: string;
  name: string;
  stream: StationStream;
  x: number;
  Tt: number;
  Pt: number;
  massFlow: number;
  area: number;
  velocity: number;
  mach: number;
  staticTemperature: number;
  staticPressure: number;
  density: number;
  continuityMassFlow: number;
}

export interface NozzleResult {
  choked: boolean;
  massFlow: number;
  throatArea: number;
  exitArea: number;
  exitMach: number;
  exitPressure: number;
  exitTemperature: number;
  exitVelocity: number;
  massFlux: number;
  momentumThrust: number;
  pressureThrust: number;
  totalEnergyResidual: number;
}

export interface CycleInputs {
  lpOmega?: number;
  hpOmega?: number;
  throttle?: number;
  ambient?: Partial<AmbientState>;
}

export interface CycleResult {
  stations: Station[];
  coreFlow: number;
  bypassFlow: number;
  inletFlow: number;
  bypassRatio: number;
  fuelFlow: number;
  thrust: number;
  fanPower: number;
  lpcPower: number;
  hpcPower: number;
  hptPower: number;
  lptPower: number;
  gearLoss: number;
  massResidual: number;
  powerResidual: number;
  normalizedMassResidual: number;
  normalizedPowerResidual: number;
  turbineInletTemp: number;
  turbineInletTemperature: number;
  fanPressureRatio: number;
  lpcPressureRatio: number;
  hpcPressureRatio: number;
  hptPressureRatio: number;
  lptPressureRatio: number;
  fanOmega: number;
  fanAngle: number;
  hpNetPower: number;
  lpNetPower: number;
  hpBearingLoss: number;
  lpBearingLoss: number;
  shaftKineticEnergy: number;
  shaftKineticPower: number;
  fuelEnergyPower: number;
  jetKineticPower: number;
  dissipationPower: number;
  energyInputPower: number;
  energyOutputPower: number;
  energyResidual: number;
  coreNozzle: NozzleResult;
  bypassNozzle: NozzleResult;
}

export interface EngineState {
  time: number;
  lpOmega: number;
  hpOmega: number;
  lpAngle: number;
  hpAngle: number;
  throttle: number;
  cycle: CycleResult;
}

export interface EngineDiagnostics {
  time: number;
  throttle: number;
  lpOmega: number;
  hpOmega: number;
  lpRpm: number;
  hpRpm: number;
  fanOmega: number;
  fanRpm: number;
  lpNetPower: number;
  hpNetPower: number;
  lpTorque: number;
  hpTorque: number;
  lpInertia: number;
  hpInertia: number;
  massResidual: number;
  powerResidual: number;
  energyResidual: number;
  shaftKineticEnergy: number;
  shaftKineticPower: number;
  dissipationPower: number;
  thrust: number;
  fuelFlow: number;
  turbineInletTemp: number;
  coreNozzle: Pick<
    NozzleResult,
    "choked" | "exitMach" | "exitPressure" | "exitVelocity"
  >;
  bypassNozzle: Pick<
    NozzleResult,
    "choked" | "exitMach" | "exitPressure" | "exitVelocity"
  >;
}

const SEA_LEVEL: AmbientState = {
  pressure: 101325,
  temperature: 288.15,
  velocity: 0,
};

interface RamState {
  Tt: number;
  Pt: number;
}

interface ComponentState {
  Tt: number;
  Pt: number;
  specificWork: number;
}

interface FlowState {
  mach: number;
  staticTemperature: number;
  staticPressure: number;
  density: number;
  velocity: number;
  continuityMassFlow: number;
}

function finite(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function throttleValue(value: number): number {
  finite("throttle", value);
  return clamp(value, 0, 1);
}

function omegaValue(name: string, value: number, low: number, high: number): number {
  finite(name, value);
  if (value < low || value > high) {
    throw new RangeError(`${name} must be between ${low} and ${high} rad/s`);
  }
  return value;
}

function ambientValue(value?: Partial<AmbientState>): AmbientState {
  const pressure = value?.pressure ?? SEA_LEVEL.pressure;
  const temperature = value?.temperature ?? SEA_LEVEL.temperature;
  const velocity = value?.velocity ?? SEA_LEVEL.velocity;
  finite("ambient.pressure", pressure);
  finite("ambient.temperature", temperature);
  finite("ambient.velocity", velocity);
  if (pressure <= 0 || temperature <= 0) {
    throw new RangeError("ambient pressure and temperature must be positive");
  }
  if (Math.abs(velocity) > 400) {
    throw new RangeError("ambient.velocity must be between -400 and 400 m/s");
  }
  return { pressure, temperature, velocity };
}

function ramTotal(ambient: AmbientState): RamState {
  const mach = Math.abs(ambient.velocity) / Math.sqrt(AIR_GAMMA * AIR_R * ambient.temperature);
  const temperatureRatio = 1 + ((AIR_GAMMA - 1) / 2) * mach ** 2;
  return {
    Tt: ambient.temperature * temperatureRatio,
    Pt: ambient.pressure * temperatureRatio ** (AIR_GAMMA / (AIR_GAMMA - 1)),
  };
}

function speedRatio(omega: number, designOmega: number): number {
  return clamp(omega / designOmega, 0.2, 1.5);
}

function compressor(
  TtIn: number,
  PtIn: number,
  pressureRatio: number,
  efficiency: number,
  cp: number,
): ComponentState {
  const exponent = (AIR_GAMMA - 1) / AIR_GAMMA;
  const Tt = TtIn * (1 + (pressureRatio ** exponent - 1) / efficiency);
  return {
    Tt,
    Pt: PtIn * pressureRatio,
    specificWork: cp * (Tt - TtIn),
  };
}

function turbine(
  TtIn: number,
  PtIn: number,
  pressureRatio: number,
): ComponentState {
  const exponent = (GAS_GAMMA - 1) / GAS_GAMMA;
  const isentropicExit = TtIn * (1 / pressureRatio) ** exponent;
  const Tt = TtIn - TURBINE_EFFICIENCY * (TtIn - isentropicExit);
  return {
    Tt,
    Pt: PtIn / pressureRatio,
    specificWork: CP_GAS * (TtIn - Tt),
  };
}

function massFlux(
  Pt: number,
  Tt: number,
  mach: number,
  gamma: number,
  gasConstant: number,
): number {
  if (mach <= 0) return 0;
  const temperatureFactor = 1 + ((gamma - 1) / 2) * mach ** 2;
  return (
    (Pt / Math.sqrt(gasConstant * Tt)) *
    Math.sqrt(gamma) *
    mach *
    temperatureFactor ** (-(gamma + 1) / (2 * (gamma - 1)))
  );
}

function staticState(
  Tt: number,
  Pt: number,
  mach: number,
  gamma: number,
  gasConstant: number,
): Omit<FlowState, "continuityMassFlow"> {
  const temperatureFactor = 1 + ((gamma - 1) / 2) * mach ** 2;
  const staticTemperature = Tt / temperatureFactor;
  const staticPressure = Pt / temperatureFactor ** (gamma / (gamma - 1));
  const density = staticPressure / (gasConstant * staticTemperature);
  return {
    mach,
    staticTemperature,
    staticPressure,
    density,
    velocity: mach * Math.sqrt(gamma * gasConstant * staticTemperature),
  };
}

function flowState(
  Tt: number,
  Pt: number,
  massFlow: number,
  area: number,
  gamma: number,
  gasConstant: number,
): FlowState {
  if (massFlow <= 0) {
    return { ...staticState(Tt, Pt, 0, gamma, gasConstant), continuityMassFlow: 0 };
  }
  const chokedMassFlow = area * massFlux(Pt, Tt, 1, gamma, gasConstant);
  if (massFlow > chokedMassFlow * (1 + 1e-10)) {
    throw new RangeError("mass flow has no subsonic solution for this fixed flow area");
  }
  let mach = 1;
  if (massFlow < chokedMassFlow) {
    let low = 0;
    let high = 1;
    for (let i = 0; i < 50; i += 1) {
      const middle = (low + high) / 2;
      if (area * massFlux(Pt, Tt, middle, gamma, gasConstant) < massFlow) {
        low = middle;
      } else {
        high = middle;
      }
    }
    mach = (low + high) / 2;
  }
  const state = staticState(Tt, Pt, mach, gamma, gasConstant);
  return {
    ...state,
    continuityMassFlow: state.density * state.velocity * area,
  };
}

function nozzle(
  Tt: number,
  Pt: number,
  area: number,
  ambient: AmbientState,
  gamma: number,
  gasConstant: number,
): NozzleResult {
  const pressureRatio = Pt / ambient.pressure;
  const criticalRatio = ((gamma + 1) / 2) ** (gamma / (gamma - 1));
  if (pressureRatio <= 1) {
    return {
      choked: false,
      massFlow: 0,
      throatArea: area,
      exitArea: area,
      exitMach: 0,
      exitPressure: Pt,
      exitTemperature: Tt,
      exitVelocity: 0,
      massFlux: 0,
      momentumThrust: 0,
      pressureThrust: (Pt - ambient.pressure) * area,
      totalEnergyResidual: 0,
    };
  }
  const choked = pressureRatio >= criticalRatio;
  const exitMach = choked
    ? 1
    : Math.sqrt(
        (2 / (gamma - 1)) *
          (pressureRatio ** ((gamma - 1) / gamma) - 1),
      );
  const exitPressure = choked ? Pt / criticalRatio : ambient.pressure;
  const exitState = staticState(Tt, Pt, exitMach, gamma, gasConstant);
  const flowMassFlux = massFlux(Pt, Tt, exitMach, gamma, gasConstant);
  const cp = (gamma * gasConstant) / (gamma - 1);
  const totalEnergy = cp * Tt;
  const exitEnergy = cp * exitState.staticTemperature + 0.5 * exitState.velocity ** 2;
  const massFlow = flowMassFlux * area;
  return {
    choked,
    massFlow,
    throatArea: area,
    exitArea: area,
    exitMach,
    exitPressure,
    exitTemperature: exitState.staticTemperature,
    exitVelocity: exitState.velocity,
    massFlux: flowMassFlux,
    momentumThrust: massFlow * exitState.velocity,
    pressureThrust: (exitPressure - ambient.pressure) * area,
    totalEnergyResidual: Math.abs(totalEnergy - exitEnergy) / Math.max(totalEnergy, 1),
  };
}

function station(
  id: string,
  name: string,
  stream: StationStream,
  x: number,
  Tt: number,
  Pt: number,
  massFlow: number,
  area: number,
  gamma: number,
  gasConstant: number,
): Station {
  const flow = flowState(Tt, Pt, massFlow, area, gamma, gasConstant);
  return {
    id,
    name,
    stream,
    x,
    Tt,
    Pt,
    massFlow,
    area,
    velocity: flow.velocity,
    mach: flow.mach,
    staticTemperature: flow.staticTemperature,
    staticPressure: flow.staticPressure,
    density: flow.density,
    continuityMassFlow: flow.continuityMassFlow,
  };
}

function buildCycle(
  lpOmega: number,
  hpOmega: number,
  throttle: number,
  ambient: AmbientState,
): CycleResult {
  const ram = ramTotal(ambient);
  const lpSpeed = speedRatio(lpOmega, DESIGN_LP_OMEGA);
  const hpSpeed = speedRatio(hpOmega, DESIGN_HP_OMEGA);

  const fanPressureRatio = 1 + 0.58 * lpSpeed ** 1.6 * (0.85 + 0.15 * throttle);
  const lpcPressureRatio = 1 + 1.25 * lpSpeed ** 1.4;
  const hpcPressureRatio =
    1 + 8.8 * hpSpeed ** 1.5 * (0.92 + 0.08 * throttle);
  const fan = compressor(ram.Tt, ram.Pt, fanPressureRatio, 0.89, CP_AIR);
  const lpc = compressor(fan.Tt, fan.Pt, lpcPressureRatio, 0.88, CP_AIR);
  const hpc = compressor(lpc.Tt, lpc.Pt, hpcPressureRatio, 0.86, CP_AIR);

  const targetTurbineInlet = clamp(1150 + 650 * throttle, hpc.Tt + 80, 1820);
  const fuelAirRatio = clamp(
    (CP_GAS * targetTurbineInlet - CP_AIR * hpc.Tt) /
      (COMBUSTOR_EFFICIENCY * FUEL_LHV - CP_GAS * targetTurbineInlet),
    0,
    MAX_FUEL_TO_AIR,
  );
  const combustorPressure = hpc.Pt * COMBUSTOR_PRESSURE_RECOVERY;

  // The illustrative turbine schedule unloads the LPT slightly as fuel is
  // added; this leaves more exhaust pressure for the fixed core nozzle while
  // the hotter gas still raises turbine work. It keeps the two-rotor transient
  // locally stable instead of making a fuel increase decelerate the LP shaft.
  const throttleExpansion = 0.9 - 0.2 * throttle;
  const requestedHptPressureRatio =
    1 + (0.8 + 1.4 * hpSpeed) * throttleExpansion;
  const requestedLptPressureRatio =
    1 + (2 + 3 * lpSpeed) * throttleExpansion;
  const maximumTotalExpansion = Math.max(
    1.04,
    combustorPressure / (ambient.pressure * 1.03),
  );
  const hptPressureRatio = Math.min(
    requestedHptPressureRatio,
    Math.max(1.02, maximumTotalExpansion * 0.42),
  );
  const lptPressureRatio = Math.min(
    requestedLptPressureRatio,
    Math.max(1.02, maximumTotalExpansion / hptPressureRatio),
  );
  const hpt = turbine(targetTurbineInlet, combustorPressure, hptPressureRatio);
  const lpt = turbine(hpt.Tt, hpt.Pt, lptPressureRatio);

  // Fixed throats determine the actual stream flow. This closes the intake,
  // split and nozzle boundary without echoing a requested mass flow.
  const coreNozzle = nozzle(
    lpt.Tt,
    lpt.Pt,
    FLOW_PATH_AREAS.coreNozzle,
    ambient,
    GAS_GAMMA,
    GAS_R,
  );
  const bypassNozzle = nozzle(
    fan.Tt,
    fan.Pt,
    FLOW_PATH_AREAS.bypassNozzle,
    ambient,
    AIR_GAMMA,
    AIR_R,
  );
  const gasFlow = coreNozzle.massFlow;
  const coreFlow = gasFlow / (1 + fuelAirRatio);
  const fuelFlow = gasFlow - coreFlow;
  const bypassFlow = bypassNozzle.massFlow;
  const inletFlow = coreFlow + bypassFlow;
  const turbineInletTemp =
    gasFlow > 0
      ? (coreFlow * CP_AIR * hpc.Tt + fuelFlow * COMBUSTOR_EFFICIENCY * FUEL_LHV) /
        (gasFlow * CP_GAS)
      : targetTurbineInlet;

  const fanPower = inletFlow * fan.specificWork;
  const lpcPower = coreFlow * lpc.specificWork;
  const hpcPower = coreFlow * hpc.specificWork;
  const hptFluidPower = gasFlow * hpt.specificWork;
  const lptFluidPower = gasFlow * lpt.specificWork;
  const hptPower = hptFluidPower * TURBINE_MECHANICAL_EFFICIENCY;
  const lptPower = lptFluidPower * TURBINE_MECHANICAL_EFFICIENCY;
  const gearLoss = fanPower * (1 / GEAR_EFFICIENCY - 1);
  const lpBearingLoss = 45000 + 0.08 * lpOmega ** 2;
  const hpBearingLoss = 35000 + 0.06 * hpOmega ** 2;
  const hpNetPower = hptPower - hpcPower - hpBearingLoss;
  const lpNetPower =
    lptPower - lpcPower - fanPower - gearLoss - lpBearingLoss;
  const powerScale = Math.max(
    hptPower + lptPower + hpcPower + lpcPower + fanPower,
    1,
  );
  const powerResidual = (Math.abs(hpNetPower) + Math.abs(lpNetPower)) / powerScale;

  const stations = [
    station(
      "inlet",
      "static ambient / ram total inlet",
      "common",
      FLOW_PATH_STATION_X.inlet,
      ram.Tt,
      ram.Pt,
      inletFlow,
      FLOW_PATH_AREAS.inlet,
      AIR_GAMMA,
      AIR_R,
    ),
    station(
      "fan-exit",
      "fan exit",
      "common",
      FLOW_PATH_STATION_X.fanExit,
      fan.Tt,
      fan.Pt,
      inletFlow,
      FLOW_PATH_AREAS.fanExit,
      AIR_GAMMA,
      AIR_R,
    ),
    station(
      "core-split",
      "core flow split",
      "core",
      FLOW_PATH_STATION_X.coreSplit,
      fan.Tt,
      fan.Pt,
      coreFlow,
      FLOW_PATH_AREAS.coreSplit,
      AIR_GAMMA,
      AIR_R,
    ),
    station(
      "lpc-exit",
      "3-stage LPC exit",
      "core",
      FLOW_PATH_STATION_X.lpcExit,
      lpc.Tt,
      lpc.Pt,
      coreFlow,
      FLOW_PATH_AREAS.lpcExit,
      AIR_GAMMA,
      AIR_R,
    ),
    station(
      "hpc-exit",
      "8-stage HPC exit",
      "core",
      FLOW_PATH_STATION_X.hpcExit,
      hpc.Tt,
      hpc.Pt,
      coreFlow,
      FLOW_PATH_AREAS.hpcExit,
      AIR_GAMMA,
      AIR_R,
    ),
    station(
      "combustor-exit",
      "annular combustor exit",
      "core",
      FLOW_PATH_STATION_X.combustorExit,
      turbineInletTemp,
      combustorPressure,
      gasFlow,
      FLOW_PATH_AREAS.combustor,
      GAS_GAMMA,
      GAS_R,
    ),
    station(
      "hpt-exit",
      "2-stage HPT exit",
      "core",
      FLOW_PATH_STATION_X.hptExit,
      hpt.Tt,
      hpt.Pt,
      gasFlow,
      FLOW_PATH_AREAS.hptExit,
      GAS_GAMMA,
      GAS_R,
    ),
    station(
      "lpt-exit",
      "3-stage LPT exit",
      "core",
      FLOW_PATH_STATION_X.lptExit,
      lpt.Tt,
      lpt.Pt,
      gasFlow,
      FLOW_PATH_AREAS.lptExit,
      GAS_GAMMA,
      GAS_R,
    ),
    station(
      "core-nozzle",
      "fixed core convergent nozzle",
      "core",
      FLOW_PATH_STATION_X.coreNozzle,
      lpt.Tt,
      lpt.Pt,
      gasFlow,
      FLOW_PATH_AREAS.coreNozzle,
      GAS_GAMMA,
      GAS_R,
    ),
    station(
      "bypass-nozzle",
      "fixed bypass convergent nozzle",
      "bypass",
      FLOW_PATH_STATION_X.bypassNozzle,
      fan.Tt,
      fan.Pt,
      bypassFlow,
      FLOW_PATH_AREAS.bypassNozzle,
      AIR_GAMMA,
      AIR_R,
    ),
  ];

  const continuityResidual = stations.reduce(
    (sum, current) =>
      sum + Math.abs(current.massFlow - current.continuityMassFlow),
    0,
  );
  const splitResidual = Math.abs(inletFlow - coreFlow - bypassFlow);
  const fuelResidual = Math.abs(gasFlow - coreFlow - fuelFlow);
  const massResidual =
    (continuityResidual + splitResidual + fuelResidual) / Math.max(inletFlow, 1);
  const thrust =
    coreNozzle.momentumThrust +
    coreNozzle.pressureThrust +
    bypassNozzle.momentumThrust +
    bypassNozzle.pressureThrust -
    inletFlow * ambient.velocity;

  const fuelEnergyPower = fuelFlow * FUEL_LHV;
  const combustionLoss = fuelEnergyPower * (1 - COMBUSTOR_EFFICIENCY);
  const turbineLoss = hptFluidPower + lptFluidPower - hptPower - lptPower;
  const dissipationPower =
    combustionLoss + turbineLoss + gearLoss + lpBearingLoss + hpBearingLoss;
  const incomingTotalEnergy = inletFlow * CP_AIR * ram.Tt;
  const exhaustTotalEnergy =
    bypassFlow * CP_AIR * fan.Tt + gasFlow * CP_GAS * lpt.Tt;
  const shaftKineticPower = hpNetPower + lpNetPower;
  const energyInputPower = incomingTotalEnergy + fuelEnergyPower;
  const energyOutputPower = exhaustTotalEnergy + shaftKineticPower + dissipationPower;
  const energyScale = Math.max(Math.abs(energyInputPower), 1);
  const energyResidual = Math.abs(energyInputPower - energyOutputPower) / energyScale;
  const jetKineticPower =
    0.5 *
    (gasFlow * coreNozzle.exitVelocity ** 2 +
      bypassFlow * bypassNozzle.exitVelocity ** 2 -
      inletFlow * ambient.velocity ** 2);

  return {
    stations,
    coreFlow,
    bypassFlow,
    inletFlow,
    bypassRatio: coreFlow > 0 ? bypassFlow / coreFlow : 0,
    fuelFlow,
    thrust,
    fanPower,
    lpcPower,
    hpcPower,
    hptPower,
    lptPower,
    gearLoss,
    massResidual,
    powerResidual,
    normalizedMassResidual: massResidual,
    normalizedPowerResidual: powerResidual,
    turbineInletTemp,
    turbineInletTemperature: turbineInletTemp,
    fanPressureRatio,
    lpcPressureRatio,
    hpcPressureRatio,
    hptPressureRatio,
    lptPressureRatio,
    fanOmega: -lpOmega / GEAR_RATIO,
    fanAngle: 0,
    hpNetPower,
    lpNetPower,
    hpBearingLoss,
    lpBearingLoss,
    shaftKineticEnergy:
      0.5 * (LP_INERTIA * lpOmega ** 2 + HP_INERTIA * hpOmega ** 2),
    shaftKineticPower,
    fuelEnergyPower,
    jetKineticPower,
    dissipationPower,
    energyInputPower,
    energyOutputPower,
    energyResidual,
    coreNozzle,
    bypassNozzle,
  };
}

function parseCycleInputs(
  inputOrLp: CycleInputs | number | undefined,
  hpOmegaArg?: number,
  throttleArg?: number,
  ambientArg?: AmbientState,
): { lpOmega: number; hpOmega: number; throttle: number; ambient: AmbientState } {
  if (typeof inputOrLp === "number") {
    return {
      lpOmega: omegaValue("lpOmega", inputOrLp, MIN_LP_OMEGA, MAX_LP_OMEGA),
      hpOmega: omegaValue(
        "hpOmega",
        hpOmegaArg ?? DESIGN_HP_OMEGA,
        MIN_HP_OMEGA,
        MAX_HP_OMEGA,
      ),
      throttle: throttleValue(throttleArg ?? 0.7),
      ambient: ambientValue(ambientArg),
    };
  }
  const input = inputOrLp ?? {};
  return {
    lpOmega: omegaValue(
      "lpOmega",
      input.lpOmega ?? DESIGN_LP_OMEGA,
      MIN_LP_OMEGA,
      MAX_LP_OMEGA,
    ),
    hpOmega: omegaValue(
      "hpOmega",
      input.hpOmega ?? DESIGN_HP_OMEGA,
      MIN_HP_OMEGA,
      MAX_HP_OMEGA,
    ),
    throttle: throttleValue(input.throttle ?? 0.7),
    ambient: ambientValue(input.ambient),
  };
}

export function evaluateCycle(inputs?: CycleInputs): CycleResult;
export function evaluateCycle(
  lpOmega: number,
  hpOmega: number,
  throttle: number,
  ambient?: AmbientState,
): CycleResult;
export function evaluateCycle(
  inputOrLp: CycleInputs | number = {},
  hpOmegaArg?: number,
  throttleArg?: number,
  ambientArg?: AmbientState,
): CycleResult {
  const parsed = parseCycleInputs(inputOrLp, hpOmegaArg, throttleArg, ambientArg);
  return buildCycle(parsed.lpOmega, parsed.hpOmega, parsed.throttle, parsed.ambient);
}

function solveRunningPoint(throttle: number): {
  lpOmega: number;
  hpOmega: number;
  cycle: CycleResult;
} {
  const seeds: Array<[number, number]> = [
    [DESIGN_LP_OMEGA, DESIGN_HP_OMEGA],
    [400, 800],
    [600, 1200],
    [800, 1600],
    [1000, 1900],
  ];
  const cycleAt = (nextLp: number, nextHp: number): CycleResult | undefined => {
    try {
      return buildCycle(nextLp, nextHp, throttle, SEA_LEVEL);
    } catch {
      return undefined;
    }
  };
  for (const seed of seeds) {
    let lpOmega = seed[0];
    let hpOmega = seed[1];
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const cycle = cycleAt(lpOmega, hpOmega);
      if (!cycle) break;
      if (cycle.powerResidual <= 1e-8) return { lpOmega, hpOmega, cycle };
      const lpStep = Math.max(1, lpOmega * 1e-3);
      const hpStep = Math.max(1, hpOmega * 1e-3);
      const lpPlus = cycleAt(Math.min(MAX_LP_OMEGA, lpOmega + lpStep), hpOmega);
      const lpMinus = cycleAt(Math.max(MIN_LP_OMEGA, lpOmega - lpStep), hpOmega);
      const hpPlus = cycleAt(lpOmega, Math.min(MAX_HP_OMEGA, hpOmega + hpStep));
      const hpMinus = cycleAt(lpOmega, Math.max(MIN_HP_OMEGA, hpOmega - hpStep));
      if (!lpPlus || !lpMinus || !hpPlus || !hpMinus) break;
      const a = (lpPlus.lpNetPower - lpMinus.lpNetPower) / (2 * lpStep);
      const b = (hpPlus.lpNetPower - hpMinus.lpNetPower) / (2 * hpStep);
      const c = (lpPlus.hpNetPower - lpMinus.hpNetPower) / (2 * lpStep);
      const d = (hpPlus.hpNetPower - hpMinus.hpNetPower) / (2 * hpStep);
      const determinant = a * d - b * c;
      if (Math.abs(determinant) < 1e-6) break;
      const deltaLp = (-cycle.lpNetPower * d + b * cycle.hpNetPower) / determinant;
      const deltaHp = (-a * cycle.hpNetPower + c * cycle.lpNetPower) / determinant;
      const residual = cycle.powerResidual;
      let accepted = false;
      for (let damping = 1; damping >= 1 / 64; damping /= 2) {
        const nextLp = lpOmega + damping * deltaLp;
        const nextHp = hpOmega + damping * deltaHp;
        if (
          nextLp < MIN_LP_OMEGA ||
          nextLp > MAX_LP_OMEGA ||
          nextHp < MIN_HP_OMEGA ||
          nextHp > MAX_HP_OMEGA
        ) {
          continue;
        }
        const nextCycle = cycleAt(nextLp, nextHp);
        if (nextCycle && nextCycle.powerResidual < residual) {
          lpOmega = nextLp;
          hpOmega = nextHp;
          accepted = true;
          break;
        }
      }
      if (!accepted) break;
    }
  }
  throw new RangeError("No converged rotor point in the operating envelope");
}

export function createEngine(throttle = 0.7): EngineState {
  const boundedThrottle = throttleValue(throttle);
  if (boundedThrottle < MIN_RUNNING_THROTTLE) {
    throw new RangeError(
      `steady running point requires throttle between ${MIN_RUNNING_THROTTLE} and 1`,
    );
  }
  const solved = solveRunningPoint(boundedThrottle);
  const { lpOmega, hpOmega, cycle } = solved;
  cycle.fanAngle = 0;
  return {
    time: 0,
    lpOmega,
    hpOmega,
    lpAngle: 0,
    hpAngle: 0,
    throttle: boundedThrottle,
    cycle,
  };
}

function checkedState(state: EngineState): void {
  finite("state.time", state.time);
  finite("state.lpOmega", state.lpOmega);
  finite("state.hpOmega", state.hpOmega);
  finite("state.lpAngle", state.lpAngle);
  finite("state.hpAngle", state.hpAngle);
  finite("state.throttle", state.throttle);
  if (state.time < 0) throw new RangeError("state.time must not be negative");
  if (state.throttle < 0 || state.throttle > 1) {
    throw new RangeError("state.throttle must be between 0 and 1");
  }
  omegaValue("state.lpOmega", state.lpOmega, MIN_LP_OMEGA, MAX_LP_OMEGA);
  omegaValue("state.hpOmega", state.hpOmega, MIN_HP_OMEGA, MAX_HP_OMEGA);
}

function assertRotorEnvelope(lpOmega: number, hpOmega: number): void {
  if (
    lpOmega < MIN_LP_OMEGA ||
    lpOmega > MAX_LP_OMEGA ||
    hpOmega < MIN_HP_OMEGA ||
    hpOmega > MAX_HP_OMEGA
  ) {
    throw new RangeError("rotor speed exceeded the converged operating envelope");
  }
}

export function advanceEngine(
  state: EngineState,
  throttle: number,
  dtSeconds: number,
): EngineState {
  checkedState(state);
  const targetThrottle = throttleValue(throttle);
  finite("dtSeconds", dtSeconds);
  if (dtSeconds < 0 || dtSeconds > MAX_ADVANCE_SECONDS) {
    throw new RangeError(`dtSeconds must be between 0 and ${MAX_ADVANCE_SECONDS}`);
  }

  let time = state.time;
  let lpOmega = state.lpOmega;
  let hpOmega = state.hpOmega;
  let lpAngle = state.lpAngle;
  let hpAngle = state.hpAngle;
  let remaining = dtSeconds;
  while (remaining > 0) {
    const dt = Math.min(remaining, MAX_SUBSTEP_SECONDS);
    const startCycle = buildCycle(lpOmega, hpOmega, targetThrottle, SEA_LEVEL);
    const startLpRate = startCycle.lpNetPower / (LP_INERTIA * lpOmega);
    const startHpRate = startCycle.hpNetPower / (HP_INERTIA * hpOmega);
    const midpointLpOmega = lpOmega + 0.5 * dt * startLpRate;
    const midpointHpOmega = hpOmega + 0.5 * dt * startHpRate;
    assertRotorEnvelope(midpointLpOmega, midpointHpOmega);

    // Explicit midpoint (RK2): evaluate the torque at the predicted midpoint
    // and apply that derivative over the full substep. This preserves the
    // transient surplus while reducing finite-step shaft-energy error.
    const midpointCycle = buildCycle(
      midpointLpOmega,
      midpointHpOmega,
      targetThrottle,
      SEA_LEVEL,
    );
    const midpointLpRate =
      midpointCycle.lpNetPower / (LP_INERTIA * midpointLpOmega);
    const midpointHpRate =
      midpointCycle.hpNetPower / (HP_INERTIA * midpointHpOmega);
    const nextLpOmega = lpOmega + midpointLpRate * dt;
    const nextHpOmega = hpOmega + midpointHpRate * dt;
    assertRotorEnvelope(nextLpOmega, nextHpOmega);
    lpAngle += ((lpOmega + nextLpOmega) / 2) * dt;
    hpAngle += ((hpOmega + nextHpOmega) / 2) * dt;
    lpOmega = nextLpOmega;
    hpOmega = nextHpOmega;
    time += dt;
    remaining -= dt;
  }
  const cycle = buildCycle(lpOmega, hpOmega, targetThrottle, SEA_LEVEL);
  cycle.fanAngle = -lpAngle / GEAR_RATIO;
  return {
    time,
    lpOmega,
    hpOmega,
    lpAngle,
    hpAngle,
    throttle: targetThrottle,
    cycle,
  };
}

export function getDiagnostics(state: EngineState): EngineDiagnostics {
  checkedState(state);
  const lpTorque = state.cycle.lpNetPower / Math.max(state.lpOmega, MIN_LP_OMEGA);
  const hpTorque = state.cycle.hpNetPower / Math.max(state.hpOmega, MIN_HP_OMEGA);
  const pickNozzle = (n: NozzleResult) => ({
    choked: n.choked,
    exitMach: n.exitMach,
    exitPressure: n.exitPressure,
    exitVelocity: n.exitVelocity,
  });
  return {
    time: state.time,
    throttle: state.throttle,
    lpOmega: state.lpOmega,
    hpOmega: state.hpOmega,
    lpRpm: (state.lpOmega * 60) / PI2,
    hpRpm: (state.hpOmega * 60) / PI2,
    fanOmega: state.cycle.fanOmega,
    fanRpm: (Math.abs(state.cycle.fanOmega) * 60) / PI2,
    lpNetPower: state.cycle.lpNetPower,
    hpNetPower: state.cycle.hpNetPower,
    lpTorque,
    hpTorque,
    lpInertia: LP_INERTIA,
    hpInertia: HP_INERTIA,
    massResidual: state.cycle.massResidual,
    powerResidual: state.cycle.powerResidual,
    energyResidual: state.cycle.energyResidual,
    shaftKineticEnergy: state.cycle.shaftKineticEnergy,
    shaftKineticPower: state.cycle.shaftKineticPower,
    dissipationPower: state.cycle.dissipationPower,
    thrust: state.cycle.thrust,
    fuelFlow: state.cycle.fuelFlow,
    turbineInletTemp: state.cycle.turbineInletTemp,
    coreNozzle: pickNozzle(state.cycle.coreNozzle),
    bypassNozzle: pickNozzle(state.cycle.bypassNozzle),
  };
}
