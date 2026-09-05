import type { EngineState, Station } from './physics.ts';
import type { StageFamily, StageInfo } from './engine-geometry.ts';

/**
 * Small, read-only views over the existing synthetic cycle and geometry.
 *
 * These diagnostics deliberately derive gas enthalpy from station states
 * instead of echoing CycleResult's component powers. They describe this
 * bounded illustrative model; they are not an off-design performance map.
 */

// Keep these illustrative efficiencies aligned with the private constants in
// physics.ts; the station enthalpy calculation below remains independent.
const COMBUSTOR_THERMAL_EFFICIENCY = 0.99;
const TURBINE_SHAFT_MECHANICAL_EFFICIENCY = 0.98;

export type DiagnosticComponent = 'compressor' | 'combustor' | 'turbine';

export interface DiagnosticStation {
  id: string;
  name: string;
  stream: Station['stream'];
  x: number;
  Tt: number;
  Pt: number;
  massFlow: number;
}

interface ComponentDiagnosticBase {
  component: DiagnosticComponent;
  label: string;
  inlet: DiagnosticStation;
  outlet: DiagnosticStation;
  /** Primary downstream flow: core air for compressors, gas for turbines. */
  massFlow: number;
  inletMassFlow: number;
  outletMassFlow: number;
  /** Compression/expansion ratio; combustor uses outlet Pt / inlet Pt. */
  pressureRatio: number;
  pressureRatioDefinition: 'outlet/inlet' | 'inlet/outlet';
  /** Signed m-dot times total enthalpy change, in W. */
  thermalEnthalpyPower: number;
  /** W; zero means the station-derived balance matches the model relation. */
  componentResidual: number;
}

export interface CompressorDiagnostics extends ComponentDiagnosticBase {
  component: 'compressor';
  label: '圧縮機（Fan + LPC + HPC）';
  coreMassFlow: number;
  bypassMassFlow: number;
  shaftDemand: number;
  /** No separate compressor shaft loss exists in the current model. */
  shaftMechanicalEfficiency: 1;
}

export interface CombustorDiagnostics extends ComponentDiagnosticBase {
  component: 'combustor';
  label: '燃焼器';
  fuelFlow: number;
  gasMassFlow: number;
  fuelAirRatio: number;
  fuelEnergyPower: number;
  /** Illustrative fuel-to-gas thermal efficiency used by physics.ts. */
  thermalEfficiency: number;
}

export interface TurbineDiagnostics extends ComponentDiagnosticBase {
  component: 'turbine';
  label: 'タービン（HPT + LPT）';
  gasPower: number;
  shaftOutput: number;
  shaftLossPower: number;
  /** Distinct from the gas-side enthalpy extraction. */
  shaftMechanicalEfficiency: number;
}

export type ComponentDiagnostics =
  | CompressorDiagnostics
  | CombustorDiagnostics
  | TurbineDiagnostics;

export interface VelocityVector {
  axial: number;
  tangential: number;
}

export interface TriangleVectorDiagnostics {
  /** Absolute velocity C. */
  C: VelocityVector;
  /** Blade velocity U in the local triangle frame. */
  U: VelocityVector;
  /** Relative velocity W, satisfying C = U + W. */
  W: VelocityVector;
  /** Component-wise C - U - W; should be floating-point zero. */
  vectorResidual: VelocityVector;
}

export interface StageTriangleDiagnostics {
  radius: number;
  axialSpeed: number;
  bladeSpeed: number;
  inlet: TriangleVectorDiagnostics;
  outlet: TriangleVectorDiagnostics;
  /** Signed Euler delta h in J/kg: compressor positive, turbine negative. */
  deltaH: number;
  /** Signed expected work from stage.specificWork. */
  expectedDeltaH: number;
  /** deltaH - expectedDeltaH, in J/kg. */
  workResidual: number;
  /** The geometry's positive loading magnitude. */
  loading: number;
}

export interface StageDiagnostics {
  stageId: string;
  family: StageFamily;
  index: number;
  name: string;
  /** Explicitly fixed geometry: these triangles are never live off-design. */
  fixedDesignPoint: true;
  designPointThrottle: 0.7;
  /** Local triangle-frame direction; this is not a world-axis claim. */
  localBladeDirection: string;
  worldRotationSign: 'fan-world-negative-relative-to-LP' | 'model-positive-rpm';
  geometry: {
    x: number;
    xStart: number;
    xEnd: number;
    bladeCount: number;
    hubRadius: number;
    tipRadius: number;
    radiusRatio: number;
    rpm: number;
    omega: number;
    axialSpeed: number;
    pitchAtMidRadius: number;
  };
  specificWork: number;
  expectedDeltaH: number;
  loading: number;
  /** Mean signed deltaH minus the signed stage specificWork. */
  workResidual: number;
  samples: StageTriangleDiagnostics[];
}

function finite(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

function stationFor(state: EngineState, id: string): Station {
  const station = state.cycle.stations.find((candidate) => candidate.id === id);
  if (!station) throw new RangeError(`missing cycle station: ${id}`);
  return station;
}

function stationView(station: Station): DiagnosticStation {
  return {
    id: station.id,
    name: station.name,
    stream: station.stream,
    x: station.x,
    Tt: station.Tt,
    Pt: station.Pt,
    massFlow: station.massFlow,
  };
}

/** Recover cp from a station's total/static ideal-gas states. */
function specificHeat(station: Station): number {
  const temperatureRatio = station.Tt / station.staticTemperature;
  const pressureRatio = station.Pt / station.staticPressure;
  if (temperatureRatio <= 1 || pressureRatio <= 1) {
    throw new RangeError(
      `station ${station.id} has no usable total/static state`,
    );
  }
  const pressureExponent = Math.log(pressureRatio) / Math.log(temperatureRatio);
  const gamma = pressureExponent / (pressureExponent - 1);
  const gasConstant =
    station.staticPressure / (station.density * station.staticTemperature);
  const cp = (gamma * gasConstant) / (gamma - 1);
  return finite(`cp(${station.id})`, cp);
}

function compressorDiagnostics(state: EngineState): CompressorDiagnostics {
  const cycle = state.cycle;
  const inlet = stationFor(state, 'inlet');
  const fanExit = stationFor(state, 'fan-exit');
  const coreSplit = stationFor(state, 'core-split');
  const lpcExit = stationFor(state, 'lpc-exit');
  const hpcExit = stationFor(state, 'hpc-exit');
  const fanThermalPower =
    inlet.massFlow * specificHeat(inlet) * (fanExit.Tt - inlet.Tt);
  const lpcThermalPower =
    coreSplit.massFlow * specificHeat(coreSplit) * (lpcExit.Tt - coreSplit.Tt);
  const hpcThermalPower =
    lpcExit.massFlow * specificHeat(lpcExit) * (hpcExit.Tt - lpcExit.Tt);
  const thermalEnthalpyPower =
    fanThermalPower + lpcThermalPower + hpcThermalPower;
  const shaftDemand = cycle.fanPower + cycle.lpcPower + cycle.hpcPower;
  return {
    component: 'compressor',
    label: '圧縮機（Fan + LPC + HPC）',
    inlet: stationView(inlet),
    outlet: stationView(hpcExit),
    massFlow: hpcExit.massFlow,
    inletMassFlow: inlet.massFlow,
    outletMassFlow: hpcExit.massFlow,
    coreMassFlow: cycle.coreFlow,
    bypassMassFlow: cycle.bypassFlow,
    pressureRatio: hpcExit.Pt / inlet.Pt,
    pressureRatioDefinition: 'outlet/inlet',
    thermalEnthalpyPower,
    componentResidual: thermalEnthalpyPower - shaftDemand,
    shaftDemand,
    shaftMechanicalEfficiency: 1,
  };
}

function combustorDiagnostics(state: EngineState): CombustorDiagnostics {
  const cycle = state.cycle;
  const inlet = stationFor(state, 'hpc-exit');
  const outlet = stationFor(state, 'combustor-exit');
  const inletEnthalpyPower = inlet.massFlow * specificHeat(inlet) * inlet.Tt;
  const outletEnthalpyPower =
    outlet.massFlow * specificHeat(outlet) * outlet.Tt;
  const thermalEnthalpyPower = outletEnthalpyPower - inletEnthalpyPower;
  const fuelEnergyPower = cycle.fuelEnergyPower;
  return {
    component: 'combustor',
    label: '燃焼器',
    inlet: stationView(inlet),
    outlet: stationView(outlet),
    massFlow: inlet.massFlow,
    inletMassFlow: inlet.massFlow,
    outletMassFlow: outlet.massFlow,
    pressureRatio: outlet.Pt / inlet.Pt,
    pressureRatioDefinition: 'outlet/inlet',
    thermalEnthalpyPower,
    componentResidual:
      thermalEnthalpyPower - fuelEnergyPower * COMBUSTOR_THERMAL_EFFICIENCY,
    fuelFlow: cycle.fuelFlow,
    gasMassFlow: outlet.massFlow,
    fuelAirRatio: cycle.fuelFlow / Math.max(inlet.massFlow, 1e-12),
    fuelEnergyPower,
    thermalEfficiency: COMBUSTOR_THERMAL_EFFICIENCY,
  };
}

function turbineDiagnostics(state: EngineState): TurbineDiagnostics {
  const cycle = state.cycle;
  const inlet = stationFor(state, 'combustor-exit');
  const outlet = stationFor(state, 'lpt-exit');
  const gasPower =
    outlet.massFlow * specificHeat(inlet) * (inlet.Tt - outlet.Tt);
  const shaftOutput = cycle.hptPower + cycle.lptPower;
  return {
    component: 'turbine',
    label: 'タービン（HPT + LPT）',
    inlet: stationView(inlet),
    outlet: stationView(outlet),
    massFlow: outlet.massFlow,
    inletMassFlow: inlet.massFlow,
    outletMassFlow: outlet.massFlow,
    pressureRatio: inlet.Pt / outlet.Pt,
    pressureRatioDefinition: 'inlet/outlet',
    thermalEnthalpyPower: -gasPower,
    componentResidual:
      gasPower * TURBINE_SHAFT_MECHANICAL_EFFICIENCY - shaftOutput,
    gasPower,
    shaftOutput,
    shaftLossPower: gasPower - shaftOutput,
    shaftMechanicalEfficiency: TURBINE_SHAFT_MECHANICAL_EFFICIENCY,
  };
}

export function getComponentDiagnostics(
  state: EngineState,
  component: 'compressor',
): CompressorDiagnostics;
export function getComponentDiagnostics(
  state: EngineState,
  component: 'combustor',
): CombustorDiagnostics;
export function getComponentDiagnostics(
  state: EngineState,
  component: 'turbine',
): TurbineDiagnostics;
export function getComponentDiagnostics(
  state: EngineState,
  component: DiagnosticComponent,
): ComponentDiagnostics;
export function getComponentDiagnostics(
  state: EngineState,
  component: DiagnosticComponent,
): ComponentDiagnostics {
  if (component === 'compressor') return compressorDiagnostics(state);
  if (component === 'combustor') return combustorDiagnostics(state);
  if (component === 'turbine') return turbineDiagnostics(state);
  throw new RangeError(`unknown component: ${String(component)}`);
}

function vector(axial: number, tangential: number): VelocityVector {
  return { axial, tangential };
}

function triangleVectors(
  axialSpeed: number,
  bladeSpeed: number,
  tangentialSpeed: number,
): TriangleVectorDiagnostics {
  const C = vector(axialSpeed, tangentialSpeed);
  const U = vector(0, bladeSpeed);
  const W = vector(axialSpeed, tangentialSpeed - bladeSpeed);
  return {
    C,
    U,
    W,
    vectorResidual: vector(
      C.axial - U.axial - W.axial,
      C.tangential - U.tangential - W.tangential,
    ),
  };
}

export function getStageDiagnostics(stage: StageInfo): StageDiagnostics {
  const turbine = stage.family === 'hpt' || stage.family === 'lpt';
  const expectedDeltaH = turbine ? -stage.specificWork : stage.specificWork;
  const samples = stage.velocityTriangles.map((triangle) => {
    const deltaH =
      triangle.bladeSpeed *
      (triangle.outletTangentialSpeed - triangle.inletTangentialSpeed);
    return {
      radius: triangle.radius,
      axialSpeed: triangle.axialSpeed,
      bladeSpeed: triangle.bladeSpeed,
      inlet: triangleVectors(
        triangle.axialSpeed,
        triangle.bladeSpeed,
        triangle.inletTangentialSpeed,
      ),
      outlet: triangleVectors(
        triangle.axialSpeed,
        triangle.bladeSpeed,
        triangle.outletTangentialSpeed,
      ),
      deltaH,
      expectedDeltaH,
      workResidual: deltaH - expectedDeltaH,
      loading: stage.stageLoading,
    } satisfies StageTriangleDiagnostics;
  });
  const workResidual =
    samples.reduce((sum, sample) => sum + sample.workResidual, 0) /
    Math.max(samples.length, 1);
  return {
    stageId: stage.id,
    family: stage.family,
    index: stage.index,
    name: stage.name,
    fixedDesignPoint: true,
    designPointThrottle: 0.7,
    localBladeDirection:
      stage.family === 'fan'
        ? 'local +θ follows fan blade motion; U is a positive magnitude; fan world rotation is negative relative to LP/sun'
        : 'local +θ follows row blade motion; U is a positive magnitude; world sign follows the model rpm convention',
    worldRotationSign:
      stage.family === 'fan'
        ? 'fan-world-negative-relative-to-LP'
        : 'model-positive-rpm',
    geometry: {
      x: stage.x,
      xStart: stage.xStart,
      xEnd: stage.xEnd,
      bladeCount: stage.bladeCount,
      hubRadius: stage.hubRadius,
      tipRadius: stage.tipRadius,
      radiusRatio: stage.radiusRatio,
      rpm: stage.rpm,
      omega: stage.omega,
      axialSpeed: stage.axialSpeed,
      pitchAtMidRadius: stage.pitchAtMidRadius,
    },
    specificWork: stage.specificWork,
    expectedDeltaH,
    loading: stage.stageLoading,
    workResidual,
    samples,
  };
}
