import * as THREE from 'three';
import {
  FLOW_PATH_AREAS,
  FLOW_PATH_STATION_X,
  createEngine,
} from './physics.ts';

/**
 * Procedural, illustrative PW1100G-JM cutaway dimensions.
 *
 * The engine axis is +X (fan to exhaust).  Y/Z are the radial plane and a
 * positive rotation is the right-hand rotation about +X.
 */
export const ENGINE_GEOMETRY_CONSTANTS = Object.freeze({
  fanDiameter: 2.0574,
  casingDiameter: 2.224,
  axialLength: 3.41,
  gearRatio: 3,
  coreFlowShroudClearance: 0.01,
  coreFlowShroudAxialMargin: 0.1,
  coreFlowShroudWall: 0.012,
  bypassCaseWall: 0.06,
  fanX: 0.2,
  gearboxX: 0.58,
  lpcX: [0.92, 1.25] as readonly [number, number],
  hpcX: [1.4, 2.0] as readonly [number, number],
  combustorX: [2.1, 2.42] as readonly [number, number],
  hptX: [2.5, 2.67] as readonly [number, number],
  lptX: [2.8, 3.25] as readonly [number, number],
  lpShaftX: [0.58, 3.25] as readonly [number, number],
  hpShaftX: [1.4, 2.68] as readonly [number, number],
});

/** Shared nominal point with `lib/physics.ts`, evaluated once at construction. */
const NOMINAL_ENGINE = createEngine(0.7);
const NOMINAL_CYCLE = NOMINAL_ENGINE.cycle;
const nominalStation = (id: string) => {
  const station = NOMINAL_CYCLE.stations.find(
    (candidate) => candidate.id === id,
  );
  if (!station) throw new Error(`Missing nominal physics station: ${id}`);
  return station;
};
const nominalStationVelocity = (id: string): number =>
  nominalStation(id).velocity;

// Recover the gas property used by the cycle from a solved station. The
// station carries total/static states and density, so the geometry remains
// coupled to physics without copying its private CP_GAS constant. This is
// needed for turbine blade work: cycle hptPower/lptPower are after mechanical
// efficiency, while the blade triangles describe the gas enthalpy drop.
const nominalGasStation = nominalStation('combustor-exit');
const nominalTemperatureExponent =
  Math.log(nominalGasStation.Pt / nominalGasStation.staticPressure) /
  Math.log(nominalGasStation.Tt / nominalGasStation.staticTemperature);
const nominalGasGamma =
  nominalTemperatureExponent / (nominalTemperatureExponent - 1);
const nominalGasConstant =
  nominalGasStation.staticPressure /
  (nominalGasStation.density * nominalGasStation.staticTemperature);
const NOMINAL_GAS_SPECIFIC_HEAT =
  (nominalGasGamma * nominalGasConstant) / (nominalGasGamma - 1);
const nominalTurbineEnthalpyDrop = Object.freeze({
  hpt:
    NOMINAL_GAS_SPECIFIC_HEAT *
    (nominalGasStation.Tt - nominalStation('hpt-exit').Tt),
  lpt:
    NOMINAL_GAS_SPECIFIC_HEAT *
    (nominalStation('hpt-exit').Tt - nominalStation('lpt-exit').Tt),
});

export const GEOMETRY_DESIGN_POINT = Object.freeze({
  throttle: NOMINAL_ENGINE.throttle,
  lpOmega: NOMINAL_ENGINE.lpOmega,
  hpOmega: NOMINAL_ENGINE.hpOmega,
  fanOmega: NOMINAL_CYCLE.fanOmega,
  lpRpm: (NOMINAL_ENGINE.lpOmega * 60) / (2 * Math.PI),
  hpRpm: (NOMINAL_ENGINE.hpOmega * 60) / (2 * Math.PI),
  fanRpm: (Math.abs(NOMINAL_CYCLE.fanOmega) * 60) / (2 * Math.PI),
  axialSpeed: Object.freeze({
    fan: nominalStationVelocity('fan-exit'),
    lpc: nominalStationVelocity('lpc-exit'),
    hpc: nominalStationVelocity('hpc-exit'),
    hpt: nominalStationVelocity('hpt-exit'),
    lpt: nominalStationVelocity('lpt-exit'),
  }),
  specificWork: Object.freeze({
    fan: NOMINAL_CYCLE.fanPower / NOMINAL_CYCLE.inletFlow,
    lpc: NOMINAL_CYCLE.lpcPower / NOMINAL_CYCLE.coreFlow / 3,
    hpc: NOMINAL_CYCLE.hpcPower / NOMINAL_CYCLE.coreFlow / 8,
    hpt: nominalTurbineEnthalpyDrop.hpt / 2,
    lpt: nominalTurbineEnthalpyDrop.lpt / 3,
  }),
  gasSpecificHeat: NOMINAL_GAS_SPECIFIC_HEAT,
  turbineEnthalpyDrop: nominalTurbineEnthalpyDrop,
});

const SOURCES = Object.freeze({
  productCard:
    'https://prd-sc102-cdn.rtx.com/prattwhitney/-/media/pw/newsroom/collateral/documents/commercial-engines/pw_gtf_pc_pw1100g-jm.pdf',
  ihi: 'https://www.ihi.co.jp/technology/techinfo/contents_no/__icsFiles/afieldfile/2023/06/16/dfa646fceb7705a3c159683b20eb8b2b.pdf',
  easa: 'https://www.easa.europa.eu/en/document-library/type-certificates/engine-cs-e/easaime093-pw1100g-jm-series-engines',
});

// Keep the illustrative row envelopes separate inside the fixed axial stage
// pitch.  These are display-model structural spans, independent of the
// shared cycle and its stage work calibration.
const ROTOR_WEB_HALF_AXIAL_SPAN = 0.018;
const ROTOR_HUB_HALF_AXIAL_SPAN = 0.018;
const STATOR_PLATFORM_HALF_AXIAL_SPAN = 0.01;

export type StageFamily = 'fan' | 'lpc' | 'hpc' | 'hpt' | 'lpt';
export type FlowStream = 'core' | 'bypass';

export interface PartInfo {
  id: string;
  name: string;
  description: string;
  source?: string;
  approximation?: string;
  x: number;
}

export interface FlowPathPoint {
  stream: FlowStream;
  x: number;
  hub: number;
  tip: number;
  hubRadius: number;
  tipRadius: number;
  area: number;
  stageId?: string;
  /** Matching fixed-cycle station, when this path point is a continuity boundary. */
  stationId?: string;
  /** Fixed cycle annulus area at stationId; area remains the geometric annulus. */
  physicsArea?: number;
}

export interface CaseProfilePoint {
  x: number;
  inner: number;
  outer: number;
}

export interface VelocityTriangle {
  stageId: string;
  family: StageFamily;
  radius: number;
  rpm: number;
  omega: number;
  axialSpeed: number;
  bladeSpeed: number;
  inletTangentialSpeed: number;
  outletTangentialSpeed: number;
  inletRelativeTangentialSpeed: number;
  outletRelativeTangentialSpeed: number;
  inletAngle: number;
  outletAngle: number;
  relativeInletAngle: number;
  relativeOutletAngle: number;
  eulerWork: number;
  expectedWork: number;
  workResidual: number;
  pitch: number;
  rotorStagger: number;
  statorStagger: number;
}

export interface StageInfo {
  id: string;
  family: StageFamily;
  index: number;
  name: string;
  description: string;
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
  specificWork: number;
  stageLoading: number;
  pitchAtMidRadius: number;
  eulerWork: number;
  velocityTriangles: VelocityTriangle[];
}

export interface WorkConsistency {
  totalEulerWork: number;
  totalExpectedWork: number;
  residual: number;
  maxResidual: number;
  byStage: Record<
    string,
    { eulerWork: number; expectedWork: number; residual: number }
  >;
}

export interface EngineGeometryResult {
  group: THREE.Group;
  fan: THREE.Group;
  lp: THREE.Group;
  hp: THREE.Group;
  stationary: THREE.Group;
  casing: THREE.Group;
  selectables: THREE.Object3D[];
  parts: PartInfo[];
  stages: StageInfo[];
  rotorStages: StageInfo[];
  stageCounts: Record<StageFamily, number>;
  velocityTriangles: VelocityTriangle[];
  workConsistency: WorkConsistency;
  flowPath: readonly FlowPathPoint[];
  caseProfile: readonly CaseProfilePoint[];
  flowShroudProfile: readonly CaseProfilePoint[];
  metadata: {
    engine: 'PW1100G-JM';
    architecture: '1fan-3LPC-8HPC-annular-combustor-2HPT-3LPT';
    fanDiameter: number;
    casingDiameter: number;
    axialLength: number;
    gearRatio: number;
    fanRpm: number;
    lpRpm: number;
    hpRpm: number;
    designPoint: typeof GEOMETRY_DESIGN_POINT;
    source: typeof SOURCES;
  };
  setAngles(lpAngle: number, hpAngle: number): void;
}

/** Closed core-case wall used by both the mesh and clearance diagnostics. */
export const CORE_CASE_PROFILE: readonly CaseProfilePoint[] = Object.freeze([
  { x: 0.55, inner: 0.43, outer: 0.49 },
  { x: 0.75, inner: 0.43, outer: 0.49 },
  { x: 0.82, inner: 0.44, outer: 0.5 },
  { x: 0.9, inner: 0.45, outer: 0.51 },
  { x: 0.94, inner: 0.45, outer: 0.51 },
  { x: 1.05, inner: 0.455, outer: 0.515 },
  { x: 1.18, inner: 0.46, outer: 0.52 },
  { x: 1.25, inner: 0.46, outer: 0.52 },
  { x: 1.36, inner: 0.46, outer: 0.52 },
  { x: 1.4, inner: 0.46, outer: 0.52 },
  { x: 1.65, inner: 0.46, outer: 0.52 },
  { x: 1.9, inner: 0.46, outer: 0.52 },
  { x: 2.08, inner: 0.42, outer: 0.48 },
  { x: 2.42, inner: 0.43, outer: 0.49 },
  { x: 2.5, inner: 0.37, outer: 0.43 },
  { x: 2.68, inner: 0.34, outer: 0.4 },
  { x: 2.78, inner: 0.34, outer: 0.4 },
  { x: 2.92, inner: 0.36, outer: 0.42 },
  { x: 3.1, inner: 0.38, outer: 0.44 },
  { x: 3.14, inner: 0.38, outer: 0.44 },
  { x: 3.26, inner: 0.39, outer: 0.45 },
  { x: 3.38, inner: 0.4, outer: 0.46 },
]);

function interpolateCaseProfile(
  profile: readonly CaseProfilePoint[],
  x: number,
  side: 'inner' | 'outer',
): number {
  if (x <= profile[0].x) return profile[0][side];
  const last = profile[profile.length - 1];
  if (x >= last.x) return last[side];
  for (let index = 1; index < profile.length; index += 1) {
    const right = profile[index];
    if (x <= right.x) {
      const left = profile[index - 1];
      const t = (x - left.x) / (right.x - left.x);
      return left[side] + (right[side] - left[side]) * t;
    }
  }
  return last[side];
}

export const coreCaseInnerRadiusAt = (x: number): number =>
  interpolateCaseProfile(CORE_CASE_PROFILE, x, 'inner');
export const coreCaseOuterRadiusAt = (x: number): number =>
  interpolateCaseProfile(CORE_CASE_PROFILE, x, 'outer');

const flowTipForArea = (hub: number, area: number): number =>
  Math.sqrt(hub * hub + area / Math.PI);
const FAN_TIP_RADIUS = ENGINE_GEOMETRY_CONSTANTS.fanDiameter / 2;
const FAN_HUB_RADIUS = Math.sqrt(
  FAN_TIP_RADIUS ** 2 - FLOW_PATH_AREAS.fanExit / Math.PI,
);

export const CORE_FLOW_PATH: readonly FlowPathPoint[] = [
  flowPathPoint('core', 0.44, 0.24, flowTipForArea(0.24, 0.36), 'front-sgv'),
  flowPathPoint(
    'core',
    FLOW_PATH_STATION_X.coreSplit,
    0.24,
    flowTipForArea(0.24, FLOW_PATH_AREAS.coreSplit),
    'core-split',
    { stationId: 'core-split', physicsArea: FLOW_PATH_AREAS.coreSplit },
  ),
  flowPathPoint(
    'core',
    0.75,
    0.245,
    flowTipForArea(0.245, 0.31),
    'core-transition',
  ),
  flowPathPoint('core', 0.82, 0.24, flowTipForArea(0.24, 0.3), 'lpc-inlet'),
  flowPathPoint('core', 0.94, 0.25, flowTipForArea(0.25, 0.29), 'lpc-1'),
  flowPathPoint('core', 1.055, 0.26, flowTipForArea(0.26, 0.27), 'lpc-2'),
  flowPathPoint(
    'core',
    FLOW_PATH_STATION_X.lpcExit,
    0.27,
    flowTipForArea(0.27, FLOW_PATH_AREAS.lpcExit),
    'lpc-3',
    { stationId: 'lpc-exit', physicsArea: FLOW_PATH_AREAS.lpcExit },
  ),
  flowPathPoint('core', 1.4, 0.32, flowTipForArea(0.32, 0.2), 'hpc-1'),
  flowPathPoint('core', 1.655, 0.335, flowTipForArea(0.335, 0.15), 'hpc-4'),
  flowPathPoint(
    'core',
    FLOW_PATH_STATION_X.hpcExit,
    0.35,
    flowTipForArea(0.35, FLOW_PATH_AREAS.hpcExit),
    'hpc-8',
    { stationId: 'hpc-exit', physicsArea: FLOW_PATH_AREAS.hpcExit },
  ),
  flowPathPoint(
    'core',
    2.1,
    0.28,
    flowTipForArea(0.28, 0.14),
    'combustor-dome',
  ),
  flowPathPoint(
    'core',
    FLOW_PATH_STATION_X.combustorExit,
    0.28,
    flowTipForArea(0.28, FLOW_PATH_AREAS.combustor),
    'combustor-exit',
    { stationId: 'combustor-exit', physicsArea: FLOW_PATH_AREAS.combustor },
  ),
  flowPathPoint('core', 2.53, 0.24, flowTipForArea(0.24, 0.115), 'hpt-1'),
  flowPathPoint(
    'core',
    FLOW_PATH_STATION_X.hptExit,
    0.24,
    flowTipForArea(0.24, FLOW_PATH_AREAS.hptExit),
    'hpt-2',
    { stationId: 'hpt-exit', physicsArea: FLOW_PATH_AREAS.hptExit },
  ),
  flowPathPoint('core', 2.82, 0.2, flowTipForArea(0.2, 0.14), 'lpt-1'),
  flowPathPoint('core', 2.98, 0.21, flowTipForArea(0.21, 0.18), 'lpt-2'),
  flowPathPoint(
    'core',
    FLOW_PATH_STATION_X.lptExit,
    0.22,
    flowTipForArea(0.22, FLOW_PATH_AREAS.lptExit),
    'lpt-3',
    { stationId: 'lpt-exit', physicsArea: FLOW_PATH_AREAS.lptExit },
  ),
  flowPathPoint(
    'core',
    FLOW_PATH_STATION_X.coreNozzle,
    0.18,
    flowTipForArea(0.18, FLOW_PATH_AREAS.coreNozzle),
    'exhaust',
    { stationId: 'core-nozzle', physicsArea: FLOW_PATH_AREAS.coreNozzle },
  ),
];

/** Thin inner gas-path shroud generated directly from the core flow envelope. */
const CORE_ROTOR_FLOW_POINTS = CORE_FLOW_PATH.filter(
  (point) =>
    point.x >= CORE_CASE_PROFILE[0].x &&
    /^(lpc|hpc|hpt|lpt)-\d+$/.test(point.stageId ?? ''),
);
const CORE_FLOW_SHROUD_STATIONS = [
  ...CORE_FLOW_PATH.filter((point) => point.x >= CORE_CASE_PROFILE[0].x).map(
    (point) => point.x,
  ),
  ...CORE_ROTOR_FLOW_POINTS.flatMap((point) => [
    point.x - ENGINE_GEOMETRY_CONSTANTS.coreFlowShroudAxialMargin,
    point.x + ENGINE_GEOMETRY_CONSTANTS.coreFlowShroudAxialMargin,
  ]),
]
  .filter((x) => x >= CORE_CASE_PROFILE[0].x && x <= CORE_FLOW_PATH.at(-1)!.x)
  .filter((x, index, values) => values.indexOf(x) === index)
  .sort((left, right) => left - right);
export const CORE_FLOW_SHROUD_PROFILE: readonly CaseProfilePoint[] =
  Object.freeze(
    CORE_FLOW_SHROUD_STATIONS.map((x) => {
      const flowTip = interpolateFlowPathRadius(CORE_FLOW_PATH, x, 'tip');
      const rotorEnvelopeTip = CORE_ROTOR_FLOW_POINTS.reduce(
        (maximum, point) =>
          Math.abs(point.x - x) <=
          ENGINE_GEOMETRY_CONSTANTS.coreFlowShroudAxialMargin + 1e-9
            ? Math.max(maximum, point.tip)
            : maximum,
        0,
      );
      const tip = Math.max(flowTip, rotorEnvelopeTip);
      return {
        x,
        inner: tip + ENGINE_GEOMETRY_CONSTANTS.coreFlowShroudClearance,
        outer:
          tip +
          ENGINE_GEOMETRY_CONSTANTS.coreFlowShroudClearance +
          ENGINE_GEOMETRY_CONSTANTS.coreFlowShroudWall,
      };
    }),
  );

export const coreFlowShroudInnerRadiusAt = (x: number): number =>
  interpolateCaseProfile(CORE_FLOW_SHROUD_PROFILE, x, 'inner');
export const coreFlowShroudOuterRadiusAt = (x: number): number =>
  interpolateCaseProfile(CORE_FLOW_SHROUD_PROFILE, x, 'outer');

export const BYPASS_FLOW_PATH: readonly FlowPathPoint[] = [
  flowPathPoint(
    'bypass',
    FLOW_PATH_STATION_X.fanExit,
    FAN_HUB_RADIUS,
    FAN_TIP_RADIUS,
    'fan',
    { stationId: 'fan-exit', physicsArea: FLOW_PATH_AREAS.fanExit },
  ),
  // The hub stays just outside the reduced core case and gearbox carrier;
  // the 2 m² annulus matches the fixed bypass nozzle continuity area.
  flowPathPoint(
    'bypass',
    FLOW_PATH_STATION_X.coreSplit,
    0.52,
    flowTipForArea(0.52, 2),
    'bypass-splitter',
  ),
  flowPathPoint('bypass', 1.25, 0.55, flowTipForArea(0.55, 2), 'bypass-duct'),
  flowPathPoint('bypass', 2.42, 0.52, flowTipForArea(0.52, 2), 'bypass-duct'),
  flowPathPoint(
    'bypass',
    FLOW_PATH_STATION_X.bypassNozzle,
    0.48,
    flowTipForArea(0.48, FLOW_PATH_AREAS.bypassNozzle),
    'bypass-nozzle',
    { stationId: 'bypass-nozzle', physicsArea: FLOW_PATH_AREAS.bypassNozzle },
  ),
];

function interpolateFlowPathRadius(
  path: readonly FlowPathPoint[],
  x: number,
  side: 'hub' | 'tip',
): number {
  if (x <= path[0].x) return path[0][side];
  const last = path[path.length - 1];
  if (x >= last.x) return last[side];
  for (let index = 1; index < path.length; index += 1) {
    const right = path[index];
    if (x <= right.x) {
      const left = path[index - 1];
      const t = (x - left.x) / (right.x - left.x);
      return left[side] + (right[side] - left[side]) * t;
    }
  }
  return last[side];
}

/** Thin outer wall generated from the actual bypass flow-line envelope. */
export const BYPASS_CASE_PROFILE: readonly CaseProfilePoint[] = Object.freeze(
  [...new Set([0.6, ...BYPASS_FLOW_PATH.map((point) => point.x), 3.38])]
    .sort((left, right) => left - right)
    .map((x) => {
      const flowTip = interpolateFlowPathRadius(BYPASS_FLOW_PATH, x, 'tip');
      return {
        x,
        inner: flowTip,
        outer: flowTip + ENGINE_GEOMETRY_CONSTANTS.bypassCaseWall,
      };
    }),
);

export const bypassCaseInnerRadiusAt = (x: number): number =>
  interpolateCaseProfile(BYPASS_CASE_PROFILE, x, 'inner');

/** Combined path for tracer and flow diagnostics. Filter by stream first. */
export const FLOW_PATH: readonly FlowPathPoint[] = Object.freeze([
  ...CORE_FLOW_PATH,
  ...BYPASS_FLOW_PATH,
]);

interface StageSpec {
  id: string;
  family: StageFamily;
  index: number;
  name: string;
  description: string;
  x: number;
  xStart: number;
  xEnd: number;
  bladeCount: number;
  hubRadius: number;
  tipRadius: number;
  rpm: number;
  axialSpeed: number;
  specificWork: number;
  stageLoading: number;
  workSign: 'compressor' | 'turbine';
  inletTangentialFactor: number;
  camber: number;
  thickness: number;
  chordRoot: number;
  chordTip: number;
}

interface Palette {
  steel: THREE.MeshStandardMaterial;
  fan: THREE.MeshStandardMaterial;
  lp: THREE.MeshStandardMaterial;
  hot: THREE.MeshStandardMaterial;
  casing: THREE.MeshStandardMaterial;
  support: THREE.MeshStandardMaterial;
}

function flowPathPoint(
  stream: FlowStream,
  x: number,
  hub: number,
  tip: number,
  stageId?: string,
  station?: { stationId: string; physicsArea: number },
): FlowPathPoint {
  return {
    stream,
    x,
    hub,
    tip,
    hubRadius: hub,
    tipRadius: tip,
    area: Math.PI * (tip * tip - hub * hub),
    ...(stageId ? { stageId } : {}),
    ...station,
  };
}

function reverseTriangleWinding(indices: number[]): void {
  for (let index = 0; index < indices.length; index += 3) {
    [indices[index + 1], indices[index + 2]] = [
      indices[index + 2],
      indices[index + 1],
    ];
  }
}

/** Orient every connected triangle component consistently across shared edges. */
function orientIndexedTriangles(indices: number[]): void {
  const triangleCount = indices.length / 3;
  const edgeUses = new Map<
    string,
    Array<{ triangle: number; direction: number }>
  >();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3;
    const vertices = [
      indices[offset],
      indices[offset + 1],
      indices[offset + 2],
    ];
    for (let edge = 0; edge < 3; edge += 1) {
      const left = vertices[edge];
      const right = vertices[(edge + 1) % 3];
      const key = left < right ? `${left}|${right}` : `${right}|${left}`;
      const direction = left < right ? 1 : -1;
      const uses = edgeUses.get(key) ?? [];
      uses.push({ triangle, direction });
      edgeUses.set(key, uses);
    }
  }

  const adjacency: Array<Array<{ triangle: number; toggle: boolean }>> =
    Array.from({ length: triangleCount }, () => []);
  for (const uses of edgeUses.values()) {
    if (uses.length !== 2) continue;
    const [left, right] = uses;
    // Equal original directions require one triangle flip; opposite directions
    // already satisfy the manifold orientation constraint.
    const toggle = left.direction === right.direction;
    adjacency[left.triangle].push({ triangle: right.triangle, toggle });
    adjacency[right.triangle].push({ triangle: left.triangle, toggle });
  }

  const flips: Array<boolean | undefined> =
    Array(triangleCount).fill(undefined);
  for (let seed = 0; seed < triangleCount; seed += 1) {
    if (flips[seed] !== undefined) continue;
    flips[seed] = false;
    const queue = [seed];
    for (let head = 0; head < queue.length; head += 1) {
      const triangle = queue[head];
      const currentFlip = flips[triangle]!;
      for (const edge of adjacency[triangle]) {
        const expectedFlip = currentFlip !== edge.toggle;
        if (flips[edge.triangle] === undefined) {
          flips[edge.triangle] = expectedFlip;
          queue.push(edge.triangle);
        }
      }
    }
  }

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    if (!flips[triangle]) continue;
    const offset = triangle * 3;
    [indices[offset + 1], indices[offset + 2]] = [
      indices[offset + 2],
      indices[offset + 1],
    ];
  }
}

function ensureOutwardWinding(
  positions: readonly number[],
  indices: number[],
): void {
  orientIndexedTriangles(indices);
  let volume = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index] * 3;
    const b = indices[index + 1] * 3;
    const c = indices[index + 2] * 3;
    volume +=
      (positions[a] *
        (positions[b + 1] * positions[c + 2] -
          positions[b + 2] * positions[c + 1]) -
        positions[a + 1] *
          (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
        positions[a + 2] *
          (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) /
      6;
  }
  if (volume < 0) reverseTriangleWinding(indices);
}

function createRingGeometry(
  xStations: readonly number[],
  innerRadii: readonly number[],
  outerRadii: readonly number[],
  radialSegments = 64,
): THREE.BufferGeometry {
  if (
    xStations.length < 2 ||
    xStations.length !== innerRadii.length ||
    xStations.length !== outerRadii.length
  ) {
    throw new RangeError('Ring profiles must have matching station arrays');
  }
  const positions: number[] = [];
  const indices: number[] = [];
  const outer: number[][] = [];
  const inner: number[][] = [];

  const addVertex = (x: number, radius: number, angle: number) => {
    const index = positions.length / 3;
    positions.push(x, radius * Math.cos(angle), radius * Math.sin(angle));
    return index;
  };

  for (let i = 0; i < xStations.length; i += 1) {
    if (innerRadii[i] <= 0 || outerRadii[i] <= innerRadii[i]) {
      throw new RangeError('Ring radii must be positive and outer > inner');
    }
    const outerRing: number[] = [];
    const innerRing: number[] = [];
    for (let j = 0; j < radialSegments; j += 1) {
      const angle = (j / radialSegments) * Math.PI * 2;
      outerRing.push(addVertex(xStations[i], outerRadii[i], angle));
      innerRing.push(addVertex(xStations[i], innerRadii[i], angle));
    }
    outer.push(outerRing);
    inner.push(innerRing);
  }

  for (let i = 0; i < xStations.length - 1; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const next = (j + 1) % radialSegments;
      indices.push(
        outer[i][j],
        outer[i + 1][j],
        outer[i + 1][next],
        outer[i][j],
        outer[i + 1][next],
        outer[i][next],
      );
      indices.push(
        inner[i][j],
        inner[i + 1][next],
        inner[i + 1][j],
        inner[i][j],
        inner[i][next],
        inner[i + 1][next],
      );
    }
  }

  for (let j = 0; j < radialSegments; j += 1) {
    const next = (j + 1) % radialSegments;
    indices.push(
      outer[0][j],
      inner[0][j],
      inner[0][next],
      outer[0][j],
      inner[0][next],
      outer[0][next],
    );
    const last = xStations.length - 1;
    indices.push(
      outer[last][j],
      outer[last][next],
      inner[last][next],
      outer[last][j],
      inner[last][next],
      inner[last][j],
    );
  }

  ensureOutwardWinding(positions, indices);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createSolidProfileGeometry(
  xStations: readonly number[],
  radii: readonly number[],
  radialSegments = 64,
): THREE.BufferGeometry {
  if (xStations.length < 2 || xStations.length !== radii.length) {
    throw new RangeError('Solid profiles must have matching station arrays');
  }
  const positions: number[] = [];
  const indices: number[] = [];
  const rings: number[][] = [];
  const addVertex = (x: number, radius: number, angle: number) => {
    const index = positions.length / 3;
    positions.push(x, radius * Math.cos(angle), radius * Math.sin(angle));
    return index;
  };

  for (let i = 0; i < xStations.length; i += 1) {
    if (radii[i] <= 0)
      throw new RangeError('Solid profile radii must be positive');
    const ring: number[] = [];
    for (let j = 0; j < radialSegments; j += 1) {
      ring.push(
        addVertex(xStations[i], radii[i], (j / radialSegments) * Math.PI * 2),
      );
    }
    rings.push(ring);
  }

  for (let i = 0; i < xStations.length - 1; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const next = (j + 1) % radialSegments;
      indices.push(
        rings[i][j],
        rings[i + 1][j],
        rings[i + 1][next],
        rings[i][j],
        rings[i + 1][next],
        rings[i][next],
      );
    }
  }

  const firstCenter = positions.length / 3;
  positions.push(xStations[0], 0, 0);
  const lastCenter = firstCenter + 1;
  positions.push(xStations[xStations.length - 1], 0, 0);
  for (let j = 0; j < radialSegments; j += 1) {
    const next = (j + 1) % radialSegments;
    indices.push(firstCenter, rings[0][next], rings[0][j]);
    const last = rings.length - 1;
    indices.push(lastCenter, rings[last][j], rings[last][next]);
  }

  ensureOutwardWinding(positions, indices);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createSolidCylinderX(
  x0: number,
  x1: number,
  radius: number,
  segments = 48,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, x1 - x0, segments),
    undefined,
  );
  mesh.rotation.z = Math.PI / 2;
  mesh.position.x = (x0 + x1) / 2;
  return mesh;
}

function createCylinderBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), 20),
    material,
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  return mesh;
}

function nacaThickness(u: number): number {
  const root = Math.sqrt(Math.max(u, 0));
  return (
    5 *
    (0.2969 * root -
      0.126 * u -
      0.3516 * u ** 2 +
      0.2843 * u ** 3 -
      0.1015 * u ** 4)
  );
}

interface AirfoilSpec {
  x: number;
  hubRadius: number;
  tipRadius: number;
  chordRoot: number;
  chordTip: number;
  staggerRoot: number;
  staggerTip: number;
  camber: number;
  thickness: number;
  sweepRoot?: number;
  sweepTip?: number;
  sections?: number;
}

/** A closed multi-section airfoil, with radial twist and axial sweep. */
function createAirfoilGeometry(spec: AirfoilSpec): THREE.BufferGeometry {
  const sectionCount = spec.sections ?? 6;
  const chordSamples = 12;
  const sectionPoints: number[][][] = [];
  const positions: number[] = [];
  const indices: number[] = [];

  const profile = (upper: boolean) => {
    const points: Array<[number, number]> = [];
    const start = upper ? 0 : chordSamples - 1;
    const end = upper ? chordSamples : 0;
    const increment = upper ? 1 : -1;
    for (let i = start; upper ? i <= end : i >= 0; i += increment) {
      const u = i / chordSamples;
      const camber = spec.camber * Math.sin(Math.PI * u);
      const thickness = spec.thickness * nacaThickness(u);
      points.push([u - 0.5, upper ? camber + thickness : camber - thickness]);
    }
    return points;
  };

  const loop = [...profile(true), ...profile(false).slice(1, -1)];
  const loopSize = loop.length;
  const addPoint = (
    x: number,
    radius: number,
    point: [number, number],
    t: number,
  ) => {
    const chord = spec.chordRoot + (spec.chordTip - spec.chordRoot) * t;
    const sweep =
      (spec.sweepRoot ?? 0) +
      ((spec.sweepTip ?? 0) - (spec.sweepRoot ?? 0)) * t;
    const stagger = spec.staggerRoot + (spec.staggerTip - spec.staggerRoot) * t;
    const axial = point[0] * chord;
    const tangential = point[1] * chord;
    const cos = Math.cos(stagger);
    const sin = Math.sin(stagger);
    const index = positions.length / 3;
    positions.push(
      x + sweep + axial * cos - tangential * sin,
      radius,
      axial * sin + tangential * cos,
    );
    return index;
  };

  for (let section = 0; section < sectionCount; section += 1) {
    const t = section / (sectionCount - 1);
    const radius = spec.hubRadius + (spec.tipRadius - spec.hubRadius) * t;
    const indicesForSection: number[] = [];
    for (const point of loop)
      indicesForSection.push(addPoint(spec.x, radius, point, t));
    sectionPoints.push([indicesForSection]);
  }

  for (let section = 0; section < sectionCount - 1; section += 1) {
    const current = sectionPoints[section][0];
    const next = sectionPoints[section + 1][0];
    for (let i = 0; i < loopSize; i += 1) {
      const j = (i + 1) % loopSize;
      indices.push(
        current[i],
        next[i],
        next[j],
        current[i],
        next[j],
        current[j],
      );
    }
  }

  const rootCenter = positions.length / 3;
  positions.push(spec.x + (spec.sweepRoot ?? 0), spec.hubRadius, 0);
  const tipCenter = rootCenter + 1;
  positions.push(spec.x + (spec.sweepTip ?? 0), spec.tipRadius, 0);
  const root = sectionPoints[0][0];
  const tip = sectionPoints[sectionCount - 1][0];
  for (let i = 0; i < loopSize; i += 1) {
    const j = (i + 1) % loopSize;
    indices.push(rootCenter, root[j], root[i]);
    indices.push(tipCenter, tip[i], tip[j]);
  }

  ensureOutwardWinding(positions, indices);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createPalette(): Palette {
  const make = (color: number, roughness: number, opacity = 1) =>
    new THREE.MeshStandardMaterial({
      color,
      metalness: 0.78,
      roughness,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: opacity >= 1,
    });
  return {
    steel: make(0x9da8b2, 0.27),
    fan: make(0x39c5d5, 0.2),
    lp: make(0xd6a24a, 0.25),
    hot: make(0xd64f3f, 0.24),
    casing: make(0x27313b, 0.4, 0.4),
    support: make(0x687782, 0.34),
  };
}

function partInfo(
  id: string,
  name: string,
  description: string,
  x: number,
  approximation?: string,
  source: string = SOURCES.productCard,
): PartInfo {
  return {
    id,
    name,
    description,
    x,
    source,
    ...(approximation ? { approximation } : {}),
  };
}

function tag(
  object: THREE.Object3D,
  info: PartInfo,
  role?: string,
  stageId?: string,
): void {
  object.userData.partId = info.id;
  object.userData.partInfo = info;
  if (role) object.userData.role = role;
  if (stageId) object.userData.stageId = stageId;
}

function addTagged<T extends THREE.Object3D>(
  parent: THREE.Object3D,
  object: T,
  info: PartInfo,
  parts: PartInfo[],
  selectables: THREE.Object3D[],
  selectable = true,
  role?: string,
  stageId?: string,
): T {
  tag(object, info, role, stageId);
  parent.add(object);
  if (!parts.some((part) => part.id === info.id)) parts.push(info);
  if (selectable) selectables.push(object);
  return object;
}

function stageDescription(family: StageFamily, index: number): string {
  if (family === 'fan')
    return '減速機を介して駆動されるファンの回転翼。掃引を付けた概略翼形。';
  if (family === 'lpc') return `低圧圧縮機の第${index}段ロータ。`;
  if (family === 'hpc') return `高圧圧縮機の第${index}段ロータ。`;
  if (family === 'hpt') return `高圧タービンの第${index}段ロータ。`;
  return `低圧タービンの第${index}段ロータ。`;
}

function makeStageInfo(spec: StageSpec): StageInfo {
  const omega = (spec.rpm * Math.PI * 2) / 60;
  const radii = [
    spec.hubRadius,
    (spec.hubRadius + spec.tipRadius) / 2,
    spec.tipRadius,
  ];
  const triangles = radii.map((radius) => {
    const bladeSpeed = omega * radius;
    const inletTangentialSpeed = spec.inletTangentialFactor * bladeSpeed;
    // Calibrate tangential velocity change to the shared cycle's family work.
    // Keeping specific work constant over span gives a meaningful radial
    // loading gradient while retaining exact Euler/work metadata closure.
    const signedDelta = spec.specificWork / Math.max(bladeSpeed, 1e-9);
    const outletTangentialSpeed =
      spec.workSign === 'compressor'
        ? inletTangentialSpeed + signedDelta
        : inletTangentialSpeed - signedDelta;
    const inletRelativeTangentialSpeed = inletTangentialSpeed - bladeSpeed;
    const outletRelativeTangentialSpeed = outletTangentialSpeed - bladeSpeed;
    const eulerWork =
      spec.workSign === 'compressor'
        ? bladeSpeed * (outletTangentialSpeed - inletTangentialSpeed)
        : bladeSpeed * (inletTangentialSpeed - outletTangentialSpeed);
    const expectedWork = bladeSpeed * Math.abs(signedDelta);
    const inletAngle = Math.atan2(inletTangentialSpeed, spec.axialSpeed);
    const outletAngle = Math.atan2(outletTangentialSpeed, spec.axialSpeed);
    const relativeInletAngle = Math.atan2(
      inletRelativeTangentialSpeed,
      spec.axialSpeed,
    );
    const relativeOutletAngle = Math.atan2(
      outletRelativeTangentialSpeed,
      spec.axialSpeed,
    );
    return {
      stageId: spec.id,
      family: spec.family,
      radius,
      rpm: spec.rpm,
      omega,
      axialSpeed: spec.axialSpeed,
      bladeSpeed,
      inletTangentialSpeed,
      outletTangentialSpeed,
      inletRelativeTangentialSpeed,
      outletRelativeTangentialSpeed,
      inletAngle,
      outletAngle,
      relativeInletAngle,
      relativeOutletAngle,
      eulerWork,
      expectedWork,
      workResidual: eulerWork - expectedWork,
      pitch: (Math.PI * 2 * radius) / spec.bladeCount,
      // The displayed airfoil uses the actual design-point angle average.
      // Keep this relationship direct; a bounded fallback would make the
      // triangle and generated metal angle disagree at high loading.
      rotorStagger: (relativeInletAngle + relativeOutletAngle) * 0.5,
      statorStagger: (inletAngle + outletAngle) * 0.5,
    } satisfies VelocityTriangle;
  });
  const eulerWork =
    triangles.reduce((sum, triangle) => sum + triangle.eulerWork, 0) /
    triangles.length;
  return {
    id: spec.id,
    family: spec.family,
    index: spec.index,
    name: spec.name,
    description: spec.description,
    x: spec.x,
    xStart: spec.xStart,
    xEnd: spec.xEnd,
    bladeCount: spec.bladeCount,
    hubRadius: spec.hubRadius,
    tipRadius: spec.tipRadius,
    radiusRatio: spec.tipRadius / spec.hubRadius,
    rpm: spec.rpm,
    omega,
    axialSpeed: spec.axialSpeed,
    specificWork: spec.specificWork,
    stageLoading: spec.stageLoading,
    pitchAtMidRadius: triangles[1].pitch,
    eulerWork,
    velocityTriangles: triangles,
  };
}

function rotorMaterial(spec: StageSpec, palette: Palette): THREE.Material {
  if (spec.family === 'fan') return palette.fan;
  if (spec.family === 'lpc') return palette.lp;
  if (spec.family === 'hpt' || spec.family === 'lpt') return palette.hot;
  return palette.steel;
}

function calibratedLoading(
  family: StageFamily,
  rpm: number,
  hubRadius: number,
  tipRadius: number,
): number {
  const omega = (rpm * Math.PI * 2) / 60;
  const midRadius = (hubRadius + tipRadius) / 2;
  return GEOMETRY_DESIGN_POINT.specificWork[family] / (omega * midRadius) ** 2;
}

function addRotorStage(
  parent: THREE.Group,
  spec: StageSpec,
  stage: StageInfo,
  shaftRadius: number,
  palette: Palette,
  parts: PartInfo[],
  selectables: THREE.Object3D[],
): void {
  const info = partInfo(
    spec.id,
    spec.name,
    spec.description,
    spec.x,
    '翼枚数・翼形・内部寸法は説明用の再構成値です。ねじれはモデル運転点の速度三角形から設定しています。',
  );
  const stageGroup = addTagged(
    parent,
    new THREE.Group(),
    info,
    parts,
    selectables,
    true,
    'rotor-stage',
    spec.id,
  );
  stageGroup.name = `${spec.id}-rotor`;
  stageGroup.userData.bladeCount = spec.bladeCount;
  stageGroup.userData.hubRadius = spec.hubRadius;
  stageGroup.userData.tipRadius = spec.tipRadius;
  stageGroup.userData.velocityTriangles = stage.velocityTriangles;
  stageGroup.userData.eulerWork = stage.eulerWork;

  const mid = stage.velocityTriangles[1];
  // Triangles use +theta along the blade motion; the fan turns opposite LP.
  const rotationSign = spec.family === 'fan' ? -1 : 1;
  const bladeGeometry = createAirfoilGeometry({
    x: spec.x,
    hubRadius: spec.hubRadius,
    tipRadius: spec.tipRadius,
    chordRoot: spec.chordRoot,
    chordTip: spec.chordTip,
    staggerRoot: rotationSign * stage.velocityTriangles[0].rotorStagger,
    staggerTip: rotationSign * stage.velocityTriangles[2].rotorStagger,
    camber: rotationSign * spec.camber,
    thickness: spec.thickness,
    sweepRoot: -spec.chordRoot * 0.1,
    sweepTip: spec.chordTip * 0.13,
  });
  const material = rotorMaterial(spec, palette);
  for (let index = 0; index < spec.bladeCount; index += 1) {
    const blade = new THREE.Mesh(bladeGeometry, material);
    blade.rotation.x = (index / spec.bladeCount) * Math.PI * 2;
    blade.userData.bladeIndex = index;
    blade.userData.pitch = mid.pitch;
    tag(blade, info, 'rotor-blade', spec.id);
    stageGroup.add(blade);
  }

  const webGeometry = createRingGeometry(
    [
      spec.x - ROTOR_WEB_HALF_AXIAL_SPAN,
      spec.x - ROTOR_WEB_HALF_AXIAL_SPAN * 0.45,
      spec.x + ROTOR_WEB_HALF_AXIAL_SPAN * 0.45,
      spec.x + ROTOR_WEB_HALF_AXIAL_SPAN,
    ],
    [
      Math.max(0.012, shaftRadius - (spec.family === 'hpt' ? 0.015 : 0.007)),
      Math.max(0.012, shaftRadius - (spec.family === 'hpt' ? 0.015 : 0.007)),
      Math.max(0.012, shaftRadius - (spec.family === 'hpt' ? 0.015 : 0.007)),
      Math.max(0.012, shaftRadius - (spec.family === 'hpt' ? 0.015 : 0.007)),
    ],
    [
      spec.hubRadius - 0.045,
      spec.hubRadius,
      spec.hubRadius,
      spec.hubRadius - 0.045,
    ],
    48,
  );
  // Keep the bore open on the hollow HP shaft; its wall is intentionally
  // overlapped by this web so the disc is mechanically attached. The hub
  // itself remains an annulus for the independent LP spool to pass through.
  const web = new THREE.Mesh(
    webGeometry,
    spec.family === 'hpt' || spec.family === 'lpt' ? palette.hot : material,
  );
  web.userData.component = 'disk-web';
  tag(web, info, 'rotor-disk', spec.id);
  stageGroup.add(web);
  const hubGeometry =
    spec.family === 'hpc' || spec.family === 'hpt'
      ? createRingGeometry(
          [
            spec.x - ROTOR_HUB_HALF_AXIAL_SPAN,
            spec.x + ROTOR_HUB_HALF_AXIAL_SPAN,
          ],
          [shaftRadius, shaftRadius],
          [spec.hubRadius, spec.hubRadius],
          48,
        )
      : undefined;
  const hub = hubGeometry
    ? new THREE.Mesh(hubGeometry, material)
    : createSolidCylinderX(
        spec.x - ROTOR_HUB_HALF_AXIAL_SPAN,
        spec.x + ROTOR_HUB_HALF_AXIAL_SPAN,
        spec.hubRadius,
        48,
      );
  hub.material = material;
  hub.userData.component = 'rotor-hub';
  if (hubGeometry) hub.userData.boreRadius = shaftRadius;
  tag(hub, info, 'rotor-hub', spec.id);
  stageGroup.add(hub);
}

function addStatorRow(
  parent: THREE.Group,
  stage: StageInfo,
  x: number,
  palette: Palette,
  parts: PartInfo[],
  selectables: THREE.Object3D[],
): void {
  const info = partInfo(
    `${stage.id}-stator`,
    `${stage.name} stator`,
    `${stage.name} の後段に置く静翼列。外側シュラウドを介してケースへ荷重を伝えます。`,
    x,
    '静翼数と翼形寸法は概略値で、対応する流れ条件に合わせた表示用モデルです。',
    SOURCES.ihi,
  );
  const row = addTagged(
    parent,
    new THREE.Group(),
    info,
    parts,
    selectables,
    true,
    'stator-row',
    stage.id,
  );
  row.name = `${stage.id}-stator`;
  const triangles = stage.velocityTriangles;
  const count = Math.max(16, Math.round(stage.bladeCount * 0.74));
  const fanRow = stage.family === 'fan';
  const rotationSign = fanRow ? -1 : 1;
  const platformHalfAxialSpan = STATOR_PLATFORM_HALF_AXIAL_SPAN;
  const coreWallAtPlatformEdge = fanRow
    ? 1.05
    : Math.min(
        coreFlowShroudInnerRadiusAt(x - platformHalfAxialSpan),
        coreFlowShroudInnerRadiusAt(x + platformHalfAxialSpan),
      );
  const tip = fanRow ? stage.tipRadius + 0.02 : coreWallAtPlatformEdge - 0.012;
  const statorGeometry = createAirfoilGeometry({
    x,
    hubRadius: stage.hubRadius,
    tipRadius: tip,
    chordRoot: fanRow ? 0.07 : 0.03,
    chordTip: fanRow ? 0.05 : 0.022,
    staggerRoot: rotationSign * triangles[0].statorStagger,
    staggerTip: rotationSign * triangles[2].statorStagger,
    camber: rotationSign * (fanRow ? 0.045 : 0.035),
    thickness: fanRow ? 0.13 : 0.11,
    sweepRoot: -0.008,
    sweepTip: 0.012,
  });
  for (let index = 0; index < count; index += 1) {
    const vane = new THREE.Mesh(statorGeometry, palette.steel);
    vane.rotation.x = (index / count) * Math.PI * 2;
    vane.userData.bladeIndex = index;
    vane.userData.pitch = triangles[1].pitch;
    tag(vane, info, 'stator-vane', stage.id);
    row.add(vane);
  }
  const inner = new THREE.Mesh(
    createRingGeometry(
      [x - platformHalfAxialSpan, x + platformHalfAxialSpan],
      [
        Math.max(0.05, stage.hubRadius - 0.032),
        Math.max(0.05, stage.hubRadius - 0.032),
      ],
      [stage.hubRadius + 0.006, stage.hubRadius + 0.006],
      48,
    ),
    palette.support,
  );
  inner.userData.component = 'inner-vane-platform';
  tag(inner, info, 'stator-inner-platform', stage.id);
  row.add(inner);
  const outer = new THREE.Mesh(
    createRingGeometry(
      [x - platformHalfAxialSpan, x + platformHalfAxialSpan],
      [tip - 0.019, tip - 0.019],
      [tip + (fanRow ? 0.008 : 0.004), tip + (fanRow ? 0.008 : 0.004)],
      48,
    ),
    palette.support,
  );
  outer.userData.component = 'outer-vane-platform';
  tag(outer, info, 'stator-outer-platform', stage.id);
  row.add(outer);

  // Short shroud ties close the stationary load path from each outer platform
  // into the matching case wall. They sit in the stator plane, away from the
  // adjacent rotor row, and terminate inside the case thickness.
  // Fan stators terminate against the fan containment liner.  Core stators
  // terminate at the physical gas-path shroud, while their radial ties keep
  // running through the shroud wall and the small gap to the structural case.
  const caseInner = fanRow ? 1.05 : coreCaseInnerRadiusAt(x);
  const supportStart = tip + (fanRow ? 0.008 : 0.004);
  if (caseInner > supportStart) {
    addRadialSupports(
      row,
      info,
      x,
      supportStart,
      caseInner + 0.002,
      4,
      0.006,
      palette.support,
      parts,
      selectables,
    );
  }
}

function addRadialSupports(
  parent: THREE.Group,
  info: PartInfo,
  x: number,
  innerRadius: number,
  outerRadius: number,
  count: number,
  radius: number,
  material: THREE.Material,
  parts: PartInfo[],
  selectables: THREE.Object3D[],
): void {
  const supportGroup = addTagged(
    parent,
    new THREE.Group(),
    info,
    parts,
    selectables,
    true,
    'fixed-support-frame',
  );
  supportGroup.name = `${info.id}-supports`;
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const start = new THREE.Vector3(
      x,
      innerRadius * Math.cos(angle),
      innerRadius * Math.sin(angle),
    );
    const end = new THREE.Vector3(
      x,
      outerRadius * Math.cos(angle),
      outerRadius * Math.sin(angle),
    );
    const strut = createCylinderBetween(start, end, radius, material);
    strut.userData.supportIndex = index;
    tag(strut, info, 'fixed-support-frame');
    supportGroup.add(strut);
  }
}

function createStageSpecs(): StageSpec[] {
  const specs: StageSpec[] = [
    {
      id: 'fan',
      family: 'fan',
      index: 1,
      name: 'Fan',
      description: stageDescription('fan', 1),
      x: 0.2,
      xStart: 0.14,
      xEnd: 0.27,
      bladeCount: 20,
      hubRadius: FAN_HUB_RADIUS,
      tipRadius: FAN_TIP_RADIUS,
      rpm: GEOMETRY_DESIGN_POINT.fanRpm,
      axialSpeed: GEOMETRY_DESIGN_POINT.axialSpeed.fan,
      specificWork: GEOMETRY_DESIGN_POINT.specificWork.fan,
      stageLoading: calibratedLoading(
        'fan',
        GEOMETRY_DESIGN_POINT.fanRpm,
        FAN_HUB_RADIUS,
        FAN_TIP_RADIUS,
      ),
      workSign: 'compressor',
      inletTangentialFactor: 0,
      camber: 0.075,
      thickness: 0.12,
      chordRoot: 0.08,
      chordTip: 0.11,
    },
  ];
  const lpc = [
    [0.94, 0.25, flowTipForArea(0.25, 0.29), 30, 0.07],
    [1.055, 0.26, flowTipForArea(0.26, 0.27), 32, 0.063],
    [1.18, 0.27, flowTipForArea(0.27, FLOW_PATH_AREAS.lpcExit), 34, 0.058],
  ] as const;
  for (let index = 0; index < lpc.length; index += 1) {
    const [x, hubRadius, tipRadius, bladeCount, chord] = lpc[index];
    const rpm = GEOMETRY_DESIGN_POINT.lpRpm;
    specs.push({
      id: `lpc-${index + 1}`,
      family: 'lpc',
      index: index + 1,
      name: `LPC ${index + 1}`,
      description: stageDescription('lpc', index + 1),
      x,
      xStart: 0.92,
      xEnd: 1.25,
      bladeCount,
      hubRadius,
      tipRadius,
      rpm,
      axialSpeed: GEOMETRY_DESIGN_POINT.axialSpeed.lpc,
      specificWork: GEOMETRY_DESIGN_POINT.specificWork.lpc,
      stageLoading: calibratedLoading('lpc', rpm, hubRadius, tipRadius),
      workSign: 'compressor',
      inletTangentialFactor: 0.08 + index * 0.025,
      camber: 0.04,
      thickness: 0.11,
      chordRoot: chord,
      chordTip: chord * 0.78,
    });
  }
  const hpcXs = [1.43, 1.505, 1.58, 1.655, 1.73, 1.805, 1.88, 1.955];
  const hpcHubs = [0.32, 0.325, 0.33, 0.335, 0.34, 0.345, 0.347, 0.35];
  const hpcTips = [
    flowTipForArea(0.32, 0.2),
    flowTipForArea(0.325, 0.19),
    flowTipForArea(0.33, 0.17),
    flowTipForArea(0.335, 0.15),
    flowTipForArea(0.34, 0.14),
    flowTipForArea(0.345, 0.13),
    flowTipForArea(0.347, 0.125),
    flowTipForArea(0.35, FLOW_PATH_AREAS.hpcExit),
  ];
  for (let index = 0; index < 8; index += 1) {
    specs.push({
      id: `hpc-${index + 1}`,
      family: 'hpc',
      index: index + 1,
      name: `HPC ${index + 1}`,
      description: stageDescription('hpc', index + 1),
      x: hpcXs[index],
      xStart: 1.4,
      xEnd: 2.0,
      bladeCount: 34 + index * 2,
      hubRadius: hpcHubs[index],
      tipRadius: hpcTips[index],
      rpm: GEOMETRY_DESIGN_POINT.hpRpm,
      axialSpeed: GEOMETRY_DESIGN_POINT.axialSpeed.hpc,
      specificWork: GEOMETRY_DESIGN_POINT.specificWork.hpc,
      stageLoading: calibratedLoading(
        'hpc',
        GEOMETRY_DESIGN_POINT.hpRpm,
        hpcHubs[index],
        hpcTips[index],
      ),
      workSign: 'compressor',
      inletTangentialFactor: 0.18 + index * 0.015,
      camber: 0.034,
      thickness: 0.105,
      chordRoot: 0.041 - index * 0.001,
      chordTip: 0.031 - index * 0.00075,
    });
  }
  const hpt = [
    [2.53, 0.24, flowTipForArea(0.24, 0.115), 44],
    [2.64, 0.24, flowTipForArea(0.24, FLOW_PATH_AREAS.hptExit), 46],
  ] as const;
  for (let index = 0; index < hpt.length; index += 1) {
    const [x, hubRadius, tipRadius, bladeCount] = hpt[index];
    const rpm = GEOMETRY_DESIGN_POINT.hpRpm;
    specs.push({
      id: `hpt-${index + 1}`,
      family: 'hpt',
      index: index + 1,
      name: `HPT ${index + 1}`,
      description: stageDescription('hpt', index + 1),
      x,
      xStart: 2.5,
      xEnd: 2.67,
      bladeCount,
      hubRadius,
      tipRadius,
      rpm,
      axialSpeed: GEOMETRY_DESIGN_POINT.axialSpeed.hpt,
      specificWork: GEOMETRY_DESIGN_POINT.specificWork.hpt,
      stageLoading: calibratedLoading('hpt', rpm, hubRadius, tipRadius),
      workSign: 'turbine',
      inletTangentialFactor: 0.9 - index * 0.04,
      camber: 0.055,
      thickness: 0.125,
      chordRoot: 0.034,
      chordTip: 0.045,
    });
  }
  const lpt = [
    [2.82, 0.2, flowTipForArea(0.2, 0.14), 48],
    [2.98, 0.21, flowTipForArea(0.21, 0.18), 52],
    [3.14, 0.22, flowTipForArea(0.22, FLOW_PATH_AREAS.lptExit), 56],
  ] as const;
  for (let index = 0; index < lpt.length; index += 1) {
    const [x, hubRadius, tipRadius, bladeCount] = lpt[index];
    const rpm = GEOMETRY_DESIGN_POINT.lpRpm;
    specs.push({
      id: `lpt-${index + 1}`,
      family: 'lpt',
      index: index + 1,
      name: `LPT ${index + 1}`,
      description: stageDescription('lpt', index + 1),
      x,
      xStart: 2.8,
      xEnd: 3.25,
      bladeCount,
      hubRadius,
      tipRadius,
      rpm,
      axialSpeed: GEOMETRY_DESIGN_POINT.axialSpeed.lpt,
      specificWork: GEOMETRY_DESIGN_POINT.specificWork.lpt,
      stageLoading: calibratedLoading('lpt', rpm, hubRadius, tipRadius),
      workSign: 'turbine',
      inletTangentialFactor: 0.87 - index * 0.035,
      camber: 0.06,
      thickness: 0.12,
      chordRoot: 0.029 - index * 0.0015,
      chordTip: 0.045 - index * 0.002,
    });
  }
  return specs;
}

function addPartMesh(
  parent: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  info: PartInfo,
  parts: PartInfo[],
  selectables: THREE.Object3D[],
  role?: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  return addTagged(parent, mesh, info, parts, selectables, true, role);
}

export function createEngineGeometry(): EngineGeometryResult {
  const palette = createPalette();
  const parts: PartInfo[] = [];
  const selectables: THREE.Object3D[] = [];
  const root = new THREE.Group();
  root.name = 'PW1100G-JM cutaway';
  root.userData.engine = 'PW1100G-JM';
  root.userData.axis = '+X fan-to-exhaust';

  const fan = new THREE.Group();
  fan.name = 'fan';
  const lp = new THREE.Group();
  lp.name = 'lp-spool';
  const hp = new THREE.Group();
  hp.name = 'hp-spool';
  const stationary = new THREE.Group();
  stationary.name = 'stationary';
  const casing = new THREE.Group();
  casing.name = 'casing';
  root.add(fan, lp, hp, stationary, casing);

  const specs = createStageSpecs();
  const stages = specs.map(makeStageInfo);
  const velocityTriangles = stages.flatMap((stage) => stage.velocityTriangles);
  const rotorStages = stages;
  const stageCounts: Record<StageFamily, number> = {
    fan: 1,
    lpc: 3,
    hpc: 8,
    hpt: 2,
    lpt: 3,
  };
  const byStage: WorkConsistency['byStage'] = {};
  for (const stage of stages) {
    const expectedWork =
      stage.velocityTriangles.reduce(
        (sum, triangle) => sum + triangle.expectedWork,
        0,
      ) / 3;
    byStage[stage.id] = {
      eulerWork: stage.eulerWork,
      expectedWork,
      residual: stage.eulerWork - expectedWork,
    };
  }
  const totalEulerWork = stages.reduce(
    (sum, stage) => sum + stage.eulerWork,
    0,
  );
  const totalExpectedWork = Object.values(byStage).reduce(
    (sum, item) => sum + item.expectedWork,
    0,
  );
  const workConsistency: WorkConsistency = {
    totalEulerWork,
    totalExpectedWork,
    residual: totalEulerWork - totalExpectedWork,
    maxResidual: Math.max(
      ...Object.values(byStage).map((item) => Math.abs(item.residual)),
    ),
    byStage,
  };

  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const specById = new Map(specs.map((spec) => [spec.id, spec]));
  addRotorStage(
    fan,
    specById.get('fan')!,
    stageById.get('fan')!,
    0.055,
    palette,
    parts,
    selectables,
  );
  for (const stage of stages.filter((item) => item.family === 'lpc')) {
    addRotorStage(
      lp,
      specById.get(stage.id)!,
      stage,
      0.035,
      palette,
      parts,
      selectables,
    );
  }
  for (const stage of stages.filter((item) => item.family === 'hpc')) {
    addRotorStage(
      hp,
      specById.get(stage.id)!,
      stage,
      0.095,
      palette,
      parts,
      selectables,
    );
  }
  for (const stage of stages.filter((item) => item.family === 'hpt')) {
    addRotorStage(
      hp,
      specById.get(stage.id)!,
      stage,
      0.095,
      palette,
      parts,
      selectables,
    );
  }
  for (const stage of stages.filter((item) => item.family === 'lpt')) {
    addRotorStage(
      lp,
      specById.get(stage.id)!,
      stage,
      0.035,
      palette,
      parts,
      selectables,
    );
  }

  const fanShaftInfo = partInfo(
    'fan-output-shaft',
    'Fan output shaft',
    '減速機のリング出力をファンへ伝える軸。LP入力軸とは別に回転します。',
    0.38,
    '接続部の寸法は説明用です。',
    SOURCES.ihi,
  );
  const fanShaft = addPartMesh(
    fan,
    new THREE.CylinderGeometry(0.055, 0.055, 0.35, 48),
    palette.fan,
    fanShaftInfo,
    parts,
    selectables,
    'fan-output-shaft',
  );
  fanShaft.rotation.z = Math.PI / 2;
  fanShaft.position.x = 0.375;
  fanShaft.userData.xStart = 0.2;
  fanShaft.userData.xEnd = 0.55;
  fanShaft.userData.radius = 0.055;
  fanShaft.userData.gearInterface = 'ring-output';

  const fanHubInfo = partInfo(
    'fan-hub',
    'Fan hub',
    'ファン翼とディスクの根元を支える空力ハブ。',
    0.2,
    'ハブ外形は表示用の概略形状です。',
  );
  const fanHub = addPartMesh(
    fan,
    createSolidProfileGeometry(
      [0.11, 0.15, 0.2, 0.25, 0.3],
      [0.07, 0.14, FAN_HUB_RADIUS, FAN_HUB_RADIUS, 0.14],
    ),
    palette.fan,
    fanHubInfo,
    parts,
    selectables,
    'fan-hub',
  );
  fanHub.userData.component = 'fan-hub';

  const lpShaftInfo = partInfo(
    'lp-inner-shaft',
    'LP inner shaft',
    'LPT・LPCと減速機のサン入力をつなぐ低圧スプール軸。',
    1.915,
    '半径35 mmの一様軸として構造を概略化しています。',
    SOURCES.ihi,
  );
  const lpShaft = addPartMesh(
    lp,
    new THREE.CylinderGeometry(0.035, 0.035, 2.67, 48),
    palette.lp,
    lpShaftInfo,
    parts,
    selectables,
    'lp-shaft',
  );
  lpShaft.rotation.z = Math.PI / 2;
  lpShaft.position.x =
    (ENGINE_GEOMETRY_CONSTANTS.lpShaftX[0] +
      ENGINE_GEOMETRY_CONSTANTS.lpShaftX[1]) /
    2;
  lpShaft.userData.xStart = ENGINE_GEOMETRY_CONSTANTS.lpShaftX[0];
  lpShaft.userData.xEnd = ENGINE_GEOMETRY_CONSTANTS.lpShaftX[1];

  const hpShaftInfo = partInfo(
    'hp-hollow-shaft',
    'HP hollow shaft',
    'HPCディスクとHPTディスクをつなぐ高圧スプールの中空軸。',
    2.04,
    '内径120 mm、外径190 mmは構造を示す概略寸法です。',
    SOURCES.ihi,
  );
  const hpShaft = addPartMesh(
    hp,
    createRingGeometry([1.4, 2.68], [0.06, 0.06], [0.095, 0.095], 64),
    palette.steel,
    hpShaftInfo,
    parts,
    selectables,
    'hp-hollow-shaft',
  );
  hpShaft.userData.xStart = ENGINE_GEOMETRY_CONSTANTS.hpShaftX[0];
  hpShaft.userData.xEnd = ENGINE_GEOMETRY_CONSTANTS.hpShaftX[1];
  hpShaft.userData.boreRadius = 0.06;
  hpShaft.userData.outerRadius = 0.095;

  const noseInfo = partInfo(
    'fan-spinner',
    'Fan spinner',
    'ファンディスク前方のスピナーとノーズコーン。',
    0.09,
    'スピナー外形は表示用の概略形状です。',
  );
  addPartMesh(
    fan,
    createSolidProfileGeometry(
      [0.025, 0.08, 0.14, 0.19],
      [0.028, 0.09, 0.14, 0.16],
    ),
    palette.fan,
    noseInfo,
    parts,
    selectables,
    'spinner',
  );

  const centerBodyInfo = partInfo(
    'front-center-body',
    'Front centre body',
    '前方軸受の荷重を受け、回転するファン軸の通路を確保する中空センターボディ。',
    0.45,
    '環状シェルで前方軸受支持部を概略化しています。',
    SOURCES.ihi,
  );
  addPartMesh(
    stationary,
    createRingGeometry(
      [0.28, 0.42, 0.62],
      [0.072, 0.072, 0.062],
      [0.18, 0.16, 0.1],
      64,
    ),
    palette.support,
    centerBodyInfo,
    parts,
    selectables,
    'front-center-body',
  );

  const sgvInfo = partInfo(
    'front-sgv',
    'Front structural guide vanes',
    'ファンケースと前方センターボディを結び、軸受荷重を伝える前方構造案内翼。',
    0.46,
    '詳細なファンフレーム荷重経路を、8本の閉じた翼形支柱で概略化しています。',
    SOURCES.ihi,
  );
  const sgvStage = stageById.get('fan')!;
  const sgvRowStage = {
    ...sgvStage,
    id: 'front-sgv',
    name: 'Front SGV',
    description: sgvInfo.description,
    x: 0.46,
    hubRadius: 0.16,
    tipRadius: 1.0,
    velocityTriangles: sgvStage.velocityTriangles,
  } satisfies StageInfo;
  // A guide-vane row reuses the fan's absolute flow angles but has its own
  // structural part identity, preserving a single simple vane constructor.
  addStatorRow(stationary, sgvRowStage, 0.46, palette, parts, selectables);
  const sgvGroup = stationary.children[stationary.children.length - 1];
  const generatedSgvInfoIndex = parts.findIndex(
    (part) => part.id === 'front-sgv-stator',
  );
  if (generatedSgvInfoIndex >= 0) parts.splice(generatedSgvInfoIndex, 1);
  if (!parts.some((part) => part.id === sgvInfo.id)) parts.push(sgvInfo);
  tag(sgvGroup, sgvInfo, 'structural-guide-vane-row');
  for (const child of sgvGroup.children)
    tag(child, sgvInfo, 'structural-guide-vane', 'front-sgv');

  const lpShaftBearingInfo = partInfo(
    'front-bearing-frame',
    'Front bearing frame',
    'ファン軸と低圧軸の移行部を支える固定軸受ハウジングと放射状フレーム。',
    0.54,
    '軸受ローラーとシールは省略し、閉じたハウジングと6本の荷重スポークで表現しています。',
    SOURCES.ihi,
  );
  addPartMesh(
    stationary,
    createRingGeometry([0.5, 0.57], [0.067, 0.067], [0.13, 0.13], 48),
    palette.support,
    lpShaftBearingInfo,
    parts,
    selectables,
    'bearing-housing',
  );
  addRadialSupports(
    stationary,
    lpShaftBearingInfo,
    0.535,
    0.13,
    1.04,
    6,
    0.021,
    palette.support,
    parts,
    selectables,
  );

  const carrierSupportInfo = partInfo(
    'gearbox-carrier-support',
    'Reduction gearbox carrier support',
    '後方キャリアプレートを受け、減速機の荷重をファンケースフレームへ戻す固定環状ブラケット。',
    0.636,
    '取付ブラケットの形状と寸法は説明用です。',
    SOURCES.ihi,
  );
  const carrierSupport = addPartMesh(
    stationary,
    createRingGeometry([0.632, 0.64], [0.11, 0.11], [0.145, 0.145], 48),
    palette.support,
    carrierSupportInfo,
    parts,
    selectables,
    'gearbox-carrier-support',
  );
  carrierSupport.userData.carrierX = 0.6;
  carrierSupport.userData.contactRadialRange = [0.11, 0.1215];
  carrierSupport.userData.contactAxialRange = [0.632, 0.64];
  addRadialSupports(
    stationary,
    carrierSupportInfo,
    0.636,
    0.145,
    1.07,
    6,
    0.016,
    palette.support,
    parts,
    selectables,
  );

  const hpBearingInfo = partInfo(
    'hp-front-bearing-frame',
    'HP front bearing frame',
    'HPC入口で高圧スプール前端を支える固定フレーム。',
    1.36,
    '軸受と静翼支持部を小型の固定ハウジングで概略化しています。',
    SOURCES.ihi,
  );
  addPartMesh(
    stationary,
    createRingGeometry([1.33, 1.39], [0.11, 0.11], [0.16, 0.16], 48),
    palette.support,
    hpBearingInfo,
    parts,
    selectables,
    'bearing-housing',
  );
  addRadialSupports(
    stationary,
    hpBearingInfo,
    1.36,
    0.16,
    0.6,
    6,
    0.018,
    palette.support,
    parts,
    selectables,
  );

  const hpAftBearingInfo = partInfo(
    'hp-aft-bearing-frame',
    'HP aft bearing frame',
    'HPT後方で高圧軸を支える固定後方フレーム。',
    2.71,
    '軸受シールと付属部品を閉じたハウジングとフレームスポークで概略化しています。',
    SOURCES.ihi,
  );
  addPartMesh(
    stationary,
    createRingGeometry([2.69, 2.75], [0.105, 0.105], [0.17, 0.17], 48),
    palette.support,
    hpAftBearingInfo,
    parts,
    selectables,
    'bearing-housing',
  );
  addRadialSupports(
    stationary,
    hpAftBearingInfo,
    2.72,
    0.17,
    0.66,
    6,
    0.018,
    palette.support,
    parts,
    selectables,
  );

  const rearBearingInfo = partInfo(
    'rear-bearing-frame',
    'Rear bearing frame',
    '排気フレームで低圧系の荷重を受ける後方固定軸受ハウジング。',
    3.31,
    '排気フレームの詳細を閉じたハウジングと6本のスポークに簡略化しています。',
    SOURCES.ihi,
  );
  addPartMesh(
    stationary,
    createRingGeometry([3.28, 3.34], [0.07, 0.07], [0.16, 0.16], 48),
    palette.support,
    rearBearingInfo,
    parts,
    selectables,
    'bearing-housing',
  );
  addRadialSupports(
    stationary,
    rearBearingInfo,
    3.31,
    0.16,
    0.78,
    6,
    0.019,
    palette.support,
    parts,
    selectables,
  );

  for (const stage of stages) {
    if (stage.family === 'fan') continue;
    const statorX =
      stage.family === 'hpt'
        ? stage.x - 0.05
        : stage.family === 'lpt'
          ? stage.x - 0.08
          : stage.family === 'hpc'
            ? stage.x + 0.0375
            : stage.x + 0.0575;
    addStatorRow(stationary, stage, statorX, palette, parts, selectables);
  }

  const combustorOuterInfo = partInfo(
    'combustor-outer-liner',
    'Combustor outer liner',
    '圧縮機とタービンの間で高温ガス流路を囲む環状外側ライナ。',
    2.26,
    'ライナ厚さは概略値で、冷却孔は省略しています。',
    SOURCES.productCard,
  );
  addPartMesh(
    stationary,
    createRingGeometry([2.12, 2.42], [0.36, 0.36], [0.41, 0.41], 64),
    palette.hot,
    combustorOuterInfo,
    parts,
    selectables,
    'combustor-liner',
  );

  const combustorInnerInfo = partInfo(
    'combustor-inner-liner',
    'Combustor inner liner',
    '高圧軸まわりの環状燃焼室内周を形成する内側ライナ。',
    2.26,
    'ライナ厚さは概略値で、冷却パターンは省略しています。',
    SOURCES.productCard,
  );
  addPartMesh(
    stationary,
    createRingGeometry([2.12, 2.42], [0.24, 0.24], [0.28, 0.28], 64),
    palette.hot,
    combustorInnerInfo,
    parts,
    selectables,
    'combustor-liner',
  );

  const domeInfo = partInfo(
    'combustor-dome',
    'Combustor dome',
    '縮小するHPC流路を燃焼室ライナへ導く環状ドーム。',
    2.11,
    'ドーム曲率と希釈空気ポートをテーパー付き閉じたシェルで概略化しています。',
    SOURCES.productCard,
  );
  addPartMesh(
    stationary,
    createRingGeometry(
      [2.06, 2.12, 2.18],
      [0.24, 0.24, 0.24],
      [0.3, 0.36, 0.41],
      64,
    ),
    palette.hot,
    domeInfo,
    parts,
    selectables,
    'combustor-dome',
  );

  const injectorInfo = partInfo(
    'fuel-injectors',
    'Fuel injectors',
    '環状ドームへ燃料を供給する放射状インジェクタ本体。12本を等間隔に配置しています。',
    2.1,
    '本数とノズル形状は概略値で、各本体を閉じた円柱で表現しています。',
    SOURCES.productCard,
  );
  const injectorGroup = addTagged(
    stationary,
    new THREE.Group(),
    injectorInfo,
    parts,
    selectables,
    true,
    'fuel-system',
  );
  injectorGroup.name = 'fuel-injectors';
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    const start = new THREE.Vector3(
      2.1,
      0.44 * Math.cos(angle),
      0.44 * Math.sin(angle),
    );
    const end = new THREE.Vector3(
      2.1,
      0.27 * Math.cos(angle),
      0.27 * Math.sin(angle),
    );
    const injector = createCylinderBetween(start, end, 0.014, palette.lp);
    injector.userData.injectorIndex = index;
    tag(injector, injectorInfo, 'fuel-injector');
    injectorGroup.add(injector);
  }

  const combustorSupportInfo = partInfo(
    'combustor-case-supports',
    'Combustor case supports',
    '燃焼器外側ケースを構造フレームへ結ぶ固定放射状支持。',
    2.29,
    '支持本数と局所金具は表示用の概略です。',
    SOURCES.ihi,
  );
  addRadialSupports(
    stationary,
    combustorSupportInfo,
    2.29,
    0.43,
    0.59,
    8,
    0.014,
    palette.support,
    parts,
    selectables,
  );

  const fanCaseInfo = partInfo(
    'fan-case',
    'Fan case',
    '直径2.0574 mのファンを収めるファンケース。外径は2.224 mです。',
    0.3,
    'ナセルとアブレイダブルライナを閉じた金属環状体で概略化しています。',
    SOURCES.productCard,
  );
  addPartMesh(
    casing,
    createRingGeometry(
      [0.02, 0.12, 0.5, 0.58],
      [1.02, 1.05, 1.05, 1.05],
      [1.08, 1.112, 1.112, 1.09],
      96,
    ),
    palette.casing,
    fanCaseInfo,
    parts,
    selectables,
    'fan-case',
  );

  const coreCaseInfo = partInfo(
    'core-case',
    'Core case',
    '圧縮機で縮小し、燃焼器を経てタービンで広がるコアケース。',
    2.05,
    'ケース分割線、マウント、シュラウド間隔は表示用の概略です。',
    SOURCES.easa,
  );
  addPartMesh(
    casing,
    createRingGeometry(
      CORE_CASE_PROFILE.map((point) => point.x),
      CORE_CASE_PROFILE.map((point) => point.inner),
      CORE_CASE_PROFILE.map((point) => point.outer),
      72,
    ),
    palette.casing,
    coreCaseInfo,
    parts,
    selectables,
    'core-case',
  );

  const coreFlowShroudInfo = partInfo(
    'core-flow-shroud',
    'Core flow shroud',
    '実コア流路の先端外形に沿い、ロータ先端間隔を閉じる薄い内側流路シュラウド。',
    2.05,
    'ロータ先端間隔10 mm、壁厚12 mmの概略シェルで、掃引翼列の軸方向範囲を覆います。',
    SOURCES.ihi,
  );
  addPartMesh(
    casing,
    createRingGeometry(
      CORE_FLOW_SHROUD_PROFILE.map((point) => point.x),
      CORE_FLOW_SHROUD_PROFILE.map((point) => point.inner),
      CORE_FLOW_SHROUD_PROFILE.map((point) => point.outer),
      72,
    ),
    palette.support,
    coreFlowShroudInfo,
    parts,
    selectables,
    'core-flow-shroud',
  );

  const bypassCaseInfo = partInfo(
    'bypass-envelope',
    'Bypass flow envelope',
    'ファンスプリッタ後方でバイパス流路を囲む外側エンベロープ。',
    1.8,
    'ナセルとノズルは認証形状ではなく、表示用の概略形状です。',
    SOURCES.productCard,
  );
  addPartMesh(
    casing,
    createRingGeometry(
      BYPASS_CASE_PROFILE.map((point) => point.x),
      BYPASS_CASE_PROFILE.map((point) => point.inner),
      BYPASS_CASE_PROFILE.map((point) => point.outer),
      72,
    ),
    palette.casing,
    bypassCaseInfo,
    parts,
    selectables,
    'bypass-envelope',
  );

  root.userData.stageCounts = stageCounts;
  root.userData.flowPath = FLOW_PATH;
  root.userData.coreFlowShroudProfile = CORE_FLOW_SHROUD_PROFILE;
  root.userData.bypassCaseProfile = BYPASS_CASE_PROFILE;
  root.userData.workConsistency = workConsistency;
  root.userData.sources = SOURCES;
  root.updateMatrixWorld(true);

  const metadata = {
    engine: 'PW1100G-JM' as const,
    architecture: '1fan-3LPC-8HPC-annular-combustor-2HPT-3LPT' as const,
    fanDiameter: ENGINE_GEOMETRY_CONSTANTS.fanDiameter,
    casingDiameter: ENGINE_GEOMETRY_CONSTANTS.casingDiameter,
    axialLength: ENGINE_GEOMETRY_CONSTANTS.axialLength,
    gearRatio: ENGINE_GEOMETRY_CONSTANTS.gearRatio,
    fanRpm: GEOMETRY_DESIGN_POINT.fanRpm,
    lpRpm: GEOMETRY_DESIGN_POINT.lpRpm,
    hpRpm: GEOMETRY_DESIGN_POINT.hpRpm,
    designPoint: GEOMETRY_DESIGN_POINT,
    source: SOURCES,
  };

  return {
    group: root,
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
    flowPath: FLOW_PATH,
    caseProfile: CORE_CASE_PROFILE,
    flowShroudProfile: CORE_FLOW_SHROUD_PROFILE,
    metadata,
    setAngles(lpAngle: number, hpAngle: number): void {
      if (!Number.isFinite(lpAngle) || !Number.isFinite(hpAngle)) {
        throw new RangeError('Spool angles must be finite radians');
      }
      lp.rotation.x = lpAngle;
      hp.rotation.x = hpAngle;
      fan.rotation.x = -lpAngle / ENGINE_GEOMETRY_CONSTANTS.gearRatio;
      root.userData.angles = { lp: lpAngle, hp: hpAngle, fan: fan.rotation.x };
      root.updateMatrixWorld(true);
    },
  };
}
