import * as THREE from 'three';
import { advect, sampleFlow, transportGrid } from './flow.ts';
import type { FlowPathPoint, FlowStream } from './engine-geometry.ts';
import type { EngineState } from './physics.ts';

export type FlowField = 'temperature' | 'pressure' | 'velocity';

export interface FlowLegendStop {
  value: number;
  color: string;
}

export interface FlowFieldSpec {
  label: string;
  unit: string;
  min: number;
  max: number;
  legend: readonly FlowLegendStop[];
  colorLegend: readonly FlowLegendStop[];
}

const legend = Object.freeze([
  { value: 0, color: '#2563eb' },
  { value: 0.5, color: '#14b8a6' },
  { value: 1, color: '#ef4444' },
]);

const field = (
  label: string,
  unit: string,
  min: number,
  max: number,
): FlowFieldSpec => {
  const colorLegend = Object.freeze(
    legend.map((stop) => ({
      value: min + (max - min) * stop.value,
      color: stop.color,
    })),
  );
  return Object.freeze({
    label,
    unit,
    min,
    max,
    legend: colorLegend,
    colorLegend,
  });
};

/** Display scales are fixed so two operating points remain comparable. Pressure is Pa in physics and MPa here. */
export const FLOW_FIELDS: Readonly<Record<FlowField, FlowFieldSpec>> =
  Object.freeze({
    temperature: field('全温 Tt', 'K', 250, 1800),
    pressure: field('全圧 Pt', 'MPa', 0.08, 2.2),
    velocity: field('軸流速度', 'm/s', 0, 650),
  });

const STREAMS = ['core', 'bypass'] as const satisfies readonly FlowStream[];

// Deliberately balanced for legibility: these arrows show mean transport, not mass fraction.
const ARROWS_PER_STREAM = 18;
const PATH_AZIMUTHS = [-Math.PI / 4, -Math.PI * 0.75] as const;
const UP = new THREE.Vector3(0, 1, 0);
const LOW_FIELD_COLOR = new THREE.Color(0x2563eb);
const MID_FIELD_COLOR = new THREE.Color(0x14b8a6);
const HIGH_FIELD_COLOR = new THREE.Color(0xef4444);
const ARROW_RADIUS = 0.012;
const ARROW_LENGTH = 0.075;
const TRAIL_LENGTH = 0.13;

type TransportCell = ReturnType<typeof transportGrid>[number];

interface PathSample {
  hub: number;
  tip: number;
  hubSlope: number;
  tipSlope: number;
}

interface PathSegment {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  x0: number;
  x1: number;
}

interface StreamVisual {
  stream: FlowStream;
  points: readonly FlowPathPoint[];
  x: Float64Array;
  arrowheads: THREE.InstancedMesh<
    THREE.BufferGeometry,
    THREE.MeshBasicMaterial
  >;
  trails: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  pathSegments: PathSegment[];
  grid: TransportCell[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function checkField(value: FlowField): FlowFieldSpec {
  const spec = FLOW_FIELDS[value];
  if (!spec) throw new RangeError(`Unknown flow field: ${String(value)}`);
  return spec;
}

function checkRange(
  xRange?: readonly [number, number],
): readonly [number, number] | undefined {
  if (xRange === undefined) return undefined;
  if (
    xRange.length !== 2 ||
    !Number.isFinite(xRange[0]) ||
    !Number.isFinite(xRange[1]) ||
    xRange[0] > xRange[1]
  )
    throw new RangeError('xRange must be a finite ascending pair');
  return xRange;
}

function samplePathAt(
  points: readonly FlowPathPoint[],
  x: number,
  result: PathSample,
): void {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    result.hub = 0;
    result.tip = 0;
    result.hubSlope = 0;
    result.tipSlope = 0;
    return;
  }
  let left = first;
  let right = last;
  if (x <= first.x) right = points[1] ?? first;
  else if (x >= last.x) left = points[points.length - 2] ?? last;
  else {
    for (let index = 1; index < points.length; index += 1) {
      if (x <= points[index].x) {
        left = points[index - 1];
        right = points[index];
        break;
      }
    }
  }
  const dx = right.x - left.x;
  const t = dx > 0 ? clamp((x - left.x) / dx, 0, 1) : 0;
  result.hub = left.hub + (right.hub - left.hub) * t;
  result.tip = left.tip + (right.tip - left.tip) * t;
  result.hubSlope = dx > 0 ? (right.hub - left.hub) / dx : 0;
  result.tipSlope = dx > 0 ? (right.tip - left.tip) / dx : 0;
}

function makeRibbonSegment(
  stream: FlowStream,
  left: FlowPathPoint,
  right: FlowPathPoint,
  azimuth: number,
): PathSegment {
  const leftWidth = Math.min((left.tip - left.hub) * 0.24, 0.028);
  const rightWidth = Math.min((right.tip - right.hub) * 0.24, 0.028);
  const leftRadius = (left.hub + left.tip) / 2;
  const rightRadius = (right.hub + right.tip) / 2;
  const cos = Math.cos(azimuth);
  const sin = Math.sin(azimuth);
  const positions = new Float32Array([
    left.x,
    cos * (leftRadius - leftWidth),
    sin * (leftRadius - leftWidth),
    left.x,
    cos * (leftRadius + leftWidth),
    sin * (leftRadius + leftWidth),
    right.x,
    cos * (rightRadius - rightWidth),
    sin * (rightRadius - rightWidth),
    right.x,
    cos * (rightRadius + rightWidth),
    sin * (rightRadius + rightWidth),
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const baseColor = LOW_FIELD_COLOR;
  const colors = new Float32Array(12);
  for (let index = 0; index < 4; index += 1)
    colors.set([baseColor.r, baseColor.g, baseColor.b], index * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${stream}-mean-flow-path`;
  mesh.renderOrder = 3;
  mesh.userData.stream = stream;
  mesh.userData.meanFlow = true;
  return { mesh, x0: left.x, x1: right.x };
}

function fieldValue(
  sample: ReturnType<typeof sampleFlow>,
  selected: FlowField,
): number {
  if (selected === 'temperature') return sample.Tt;
  if (selected === 'pressure') return sample.Pt / 1e6;
  return sample.velocity;
}

function setFieldColor(
  color: THREE.Color,
  value: number,
  spec: FlowFieldSpec,
): void {
  const t = clamp((value - spec.min) / (spec.max - spec.min || 1), 0, 1);
  if (t < 0.5) color.copy(LOW_FIELD_COLOR).lerp(MID_FIELD_COLOR, t * 2);
  else color.copy(MID_FIELD_COLOR).lerp(HIGH_FIELD_COLOR, (t - 0.5) * 2);
}

function positionAt(
  points: readonly FlowPathPoint[],
  x: number,
  fraction: number,
  azimuth: number,
  sample: PathSample,
  position: THREE.Vector3,
  tangent: THREE.Vector3,
): void {
  // Azimuth stays fixed; the tangent has only axial/radial components, so this
  // depicts mean transport without suggesting CFD-resolved swirl.
  samplePathAt(points, x, sample);
  const radiusSquared =
    sample.hub * sample.hub * (1 - fraction) +
    sample.tip * sample.tip * fraction;
  const radius = Math.sqrt(Math.max(radiusSquared, 0));
  const radiusSlope =
    radius > 1e-12
      ? (sample.hub * sample.hubSlope * (1 - fraction) +
          sample.tip * sample.tipSlope * fraction) /
        radius
      : 0;
  const cos = Math.cos(azimuth);
  const sin = Math.sin(azimuth);
  position.set(x, cos * radius, sin * radius);
  tangent.set(1, cos * radiusSlope, sin * radiusSlope).normalize();
}

function setRange(
  visuals: readonly StreamVisual[],
  xRange: readonly [number, number] | undefined,
): void {
  for (const visual of visuals) {
    for (const segment of visual.pathSegments)
      segment.mesh.visible =
        xRange === undefined ||
        (segment.x1 >= xRange[0] && segment.x0 <= xRange[1]);
  }
}

export function createFlowVisual(path: readonly FlowPathPoint[]): {
  group: THREE.Group;
  update(
    state: EngineState,
    field: FlowField,
    xRange?: readonly [number, number],
  ): { continuityResidual: number };
  setClipping(planes: THREE.Plane[], intersection: boolean): void;
  dispose(): void;
} {
  const groups = new THREE.Group();
  groups.name = 'flow-visual';
  groups.userData.balancedTransportDisplay = true;
  const arrowGeometry = new THREE.ConeGeometry(ARROW_RADIUS, ARROW_LENGTH, 4);
  const visuals: StreamVisual[] = [];
  const pathSample: PathSample = {
    hub: 0,
    tip: 0,
    hubSlope: 0,
    tipSlope: 0,
  };

  for (const stream of STREAMS) {
    const points = path
      .filter((point) => point.stream === stream)
      .slice()
      .sort((left, right) => left.x - right.x);
    if (!points.length) continue;
    const streamGroup = new THREE.Group();
    streamGroup.name = `${stream}-flow`;
    streamGroup.userData.stream = stream;
    const pathSegments: PathSegment[] = [];
    for (let index = 1; index < points.length; index += 1) {
      if (points[index].x <= points[index - 1].x) continue;
      for (const azimuth of PATH_AZIMUTHS) {
        const segment = makeRibbonSegment(
          stream,
          points[index - 1],
          points[index],
          azimuth,
        );
        pathSegments.push(segment);
        streamGroup.add(segment.mesh);
      }
    }
    const arrowMaterial = new THREE.MeshBasicMaterial({
      toneMapped: false,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      depthTest: false,
    });
    const arrowheads = new THREE.InstancedMesh(
      arrowGeometry,
      arrowMaterial,
      ARROWS_PER_STREAM,
    );
    arrowheads.name = `${stream}-flow-arrowheads`;
    arrowheads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    arrowheads.frustumCulled = false;
    arrowheads.renderOrder = 5;
    arrowheads.userData.stream = stream;
    arrowheads.userData.orientedMeanFlow = true;
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(ARROWS_PER_STREAM * 6), 3),
    );
    trailGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(ARROWS_PER_STREAM * 6), 3),
    );
    const trailMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      depthTest: false,
    });
    const trails = new THREE.LineSegments(trailGeometry, trailMaterial);
    trails.name = `${stream}-flow-trails`;
    trails.frustumCulled = false;
    trails.renderOrder = 4;
    trails.userData.stream = stream;
    trails.userData.periodicTailClamped = true;
    streamGroup.add(trails, arrowheads);
    groups.add(streamGroup);
    visuals.push({
      stream,
      points,
      x: new Float64Array(ARROWS_PER_STREAM),
      arrowheads,
      trails,
      pathSegments,
      grid: [],
    });
  }
  arrowGeometry.computeBoundingSphere();

  let cachedCycle: EngineState['cycle'] | undefined;
  let continuityResidual = 0;
  let previousTime: number | undefined;
  let disposed = false;
  let activeRange: readonly [number, number] | undefined;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const tailPosition = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const trailColor = new THREE.Color();
  const fieldColor = new THREE.Color();
  const pathStartColor = new THREE.Color();
  const pathEndColor = new THREE.Color();
  const streamColor = new THREE.Color();

  function update(
    state: EngineState,
    selectedField: FlowField,
    xRange?: readonly [number, number],
  ): { continuityResidual: number } {
    if (disposed) return { continuityResidual: 0 };
    if (!Number.isFinite(state.time) || state.time < 0)
      throw new RangeError('state.time must be a finite non-negative number');
    const spec = checkField(selectedField);
    activeRange = checkRange(xRange);
    setRange(visuals, activeRange);
    if (state.cycle !== cachedCycle) {
      continuityResidual = 0;
      for (const visual of visuals) {
        visual.grid = transportGrid(visual.stream, state.cycle, path);
        for (const cell of visual.grid)
          continuityResidual = Math.max(
            continuityResidual,
            cell.continuityResidual,
          );
      }
      cachedCycle = state.cycle;
    }
    const previous = previousTime;
    const reset = previous === undefined || state.time < previous;
    const dt = reset ? 0 : state.time - previous;
    for (const visual of visuals) {
      const first = visual.grid[0]?.x0 ?? visual.points[0].x;
      const last =
        visual.grid.at(-1)?.x1 ?? visual.points[visual.points.length - 1].x;
      const span = Math.max(0, last - first);
      const trailPositions = visual.trails.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      const trailColors = visual.trails.geometry.getAttribute(
        'color',
      ) as THREE.BufferAttribute;
      for (const segment of visual.pathSegments) {
        const startSample = sampleFlow(
          visual.stream,
          segment.x0,
          state.cycle,
          path,
        );
        const endSample = sampleFlow(
          visual.stream,
          segment.x1,
          state.cycle,
          path,
        );
        setFieldColor(
          pathStartColor,
          fieldValue(startSample, selectedField),
          spec,
        );
        setFieldColor(pathEndColor, fieldValue(endSample, selectedField), spec);
        const pathColors = segment.mesh.geometry.getAttribute(
          'color',
        ) as THREE.BufferAttribute;
        pathColors.setXYZ(
          0,
          pathStartColor.r,
          pathStartColor.g,
          pathStartColor.b,
        );
        pathColors.setXYZ(
          1,
          pathStartColor.r,
          pathStartColor.g,
          pathStartColor.b,
        );
        pathColors.setXYZ(2, pathEndColor.r, pathEndColor.g, pathEndColor.b);
        pathColors.setXYZ(3, pathEndColor.r, pathEndColor.g, pathEndColor.b);
        pathColors.needsUpdate = true;
      }
      for (let index = 0; index < ARROWS_PER_STREAM; index += 1) {
        if (reset)
          visual.x[index] =
            first + span * (0.13 + 0.74 * (((index + 1) * 0.61803398875) % 1));
        else if (visual.grid.length)
          visual.x[index] = advect(visual.x[index], dt, visual.grid);
        const x = clamp(visual.x[index], first, last);
        const fraction = 0.3 + 0.4 * (((index + 1) * 0.41421356237) % 1);
        const azimuth =
          -Math.PI * 0.25 - (index % 3) * Math.PI * 0.5 + (index % 2) * 0.035;
        positionAt(
          visual.points,
          x,
          fraction,
          azimuth,
          pathSample,
          position,
          tangent,
        );
        quaternion.setFromUnitVectors(UP, tangent);
        const inRange =
          activeRange === undefined ||
          (x >= activeRange[0] && x <= activeRange[1]);
        scale.setScalar(inRange ? 1 : 0);
        matrix.compose(position, quaternion, scale);
        visual.arrowheads.setMatrixAt(index, matrix);
        const sample = sampleFlow(visual.stream, x, state.cycle, path);
        setFieldColor(fieldColor, fieldValue(sample, selectedField), spec);
        visual.arrowheads.setColorAt(index, fieldColor);
        const tailX = Math.max(first, x - TRAIL_LENGTH);
        const trailVisible = inRange && x > first + 1e-9;
        const boundedTailX =
          activeRange === undefined ? tailX : Math.max(activeRange[0], tailX);
        positionAt(
          visual.points,
          boundedTailX,
          fraction,
          azimuth,
          pathSample,
          tailPosition,
          tangent,
        );
        const offset = index * 2;
        const tail = trailVisible ? tailPosition : position;
        trailPositions.setXYZ(offset, tail.x, tail.y, tail.z);
        trailPositions.setXYZ(offset + 1, position.x, position.y, position.z);
        streamColor.copy(fieldColor);
        trailColor.copy(fieldColor).multiplyScalar(0.55);
        if (!trailVisible) streamColor.multiplyScalar(0.2);
        trailColors.setXYZ(offset, trailColor.r, trailColor.g, trailColor.b);
        trailColors.setXYZ(
          offset + 1,
          streamColor.r,
          streamColor.g,
          streamColor.b,
        );
      }
      visual.arrowheads.instanceMatrix.needsUpdate = true;
      if (visual.arrowheads.instanceColor)
        visual.arrowheads.instanceColor.needsUpdate = true;
      trailPositions.needsUpdate = true;
      trailColors.needsUpdate = true;
    }
    previousTime = state.time;
    return { continuityResidual };
  }

  function setClipping(planes: THREE.Plane[], intersection: boolean): void {
    if (disposed) return;
    const clippingPlanes = planes.slice();
    groups.traverse((object) => {
      const materials =
        object instanceof THREE.Mesh || object instanceof THREE.Line
          ? Array.isArray(object.material)
            ? object.material
            : [object.material]
          : [];
      for (const material of materials) {
        material.clippingPlanes = clippingPlanes;
        material.clipIntersection = intersection;
        material.needsUpdate = true;
      }
    });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    groups.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.LineSegments ||
        object instanceof THREE.Line
      ) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materials.add(material);
      }
    });
    geometries.add(arrowGeometry);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    groups.clear();
  }

  return { group: groups, update, setClipping, dispose };
}
