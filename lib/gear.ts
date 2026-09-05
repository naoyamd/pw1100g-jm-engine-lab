import * as THREE from 'three';

export interface GearProfileOptions {
  module?: number;
  pressureAngle?: number;
  backlash?: number;
  addendum?: number;
  dedendum?: number;
  samplesPerFlank?: number;
  samplesPerTip?: number;
  samplesPerRoot?: number;
  phase?: number;
}

export interface GearboxOptions {
  highlightTooth?: number | null;
  helixSlices?: number;
}

export interface GearAngles {
  sun: number;
  stars: number[];
  ring: number;
  carrier: number;
  sunAngle: number;
  starAngles: number[];
  ringAngle: number;
}

export interface Gearbox {
  group: THREE.Group;
  sun: THREE.Group;
  stars: THREE.Group[];
  ring: THREE.Group;
  carrier: THREE.Group;
  inputShaft: THREE.Group;
  outputShaft: THREE.Group;
  setAngle: (lpAngle: number) => void;
  setHighlight: (toothIndex: number | null) => void;
  setRotationIndex: (toothIndex: number | null) => void;
}

const DEG = Math.PI / 180;
const ZS = 30;
const ZP = 30;
const ZR = 90;
const STAR_COUNT = 5;
const MODULE = 0.0045;
const PRESSURE_ANGLE = 20 * DEG;
const HELIX_ANGLE = 20 * DEG;
const FACE_WIDTH = 0.06;
const CENTRAL_RELIEF = 0.006;
// Ideal rigid contact; zero backlash is not a manufacturing tolerance.
const BACKLASH = 0;
const MESH_FLANK_SAMPLES = 16;
const MESH_TIP_SAMPLES = 4;
const MESH_ROOT_SAMPLES = 4;
const SUN_BORE_RADIUS = 0.04;
const STAR_BORE_RADIUS = 0.014;
const JOURNAL_PIN_RADIUS = 0.0085;
const INPUT_SHAFT_RADIUS = 0.035;
const OUTPUT_SHAFT_RADIUS = 0.055;
const CARRIER_HUB_BORE = 0.044;
const CARRIER_HUB_OUTER = 0.054;
// A half tooth pitch puts the star tooth gap on the sun line at lpAngle=0.
// The ring's complementary zero phase presents its tooth flank to the same
// star gap. These are the ideal zero-backlash contact phases for the two
// meshes; polygonized chords are checked separately for finite overlap.
const STAR_PHASE = Math.PI / ZP;
// The internal ring's tooth centre is aligned with the star gap at lpAngle=0.
// This complementary phase follows from the star's sun-mesh phase above.
const RING_PHASE = 0;

const SUN_PITCH_RADIUS = (MODULE * ZS) / 2;
const STAR_PITCH_RADIUS = (MODULE * ZP) / 2;
const RING_PITCH_RADIUS = (MODULE * ZR) / 2;
const STAR_ORBIT_RADIUS = SUN_PITCH_RADIUS + STAR_PITCH_RADIUS;
const CARRIER_OUTER_RING_INNER = STAR_ORBIT_RADIUS + JOURNAL_PIN_RADIUS - 0.001;
const CARRIER_OUTER_RING_OUTER = CARRIER_OUTER_RING_INNER + 0.01;

/**
 * Illustrative first-stage planetary reducer dimensions. These are deliberately
 * not claimed to be factory PW1100G tooth counts or fine geometry.
 */
export const GEAR = Object.freeze({
  Zs: ZS,
  Zp: ZP,
  Zr: ZR,
  sunTeeth: ZS,
  starTeeth: ZP,
  ringTeeth: ZR,
  starCount: STAR_COUNT,
  planetCount: STAR_COUNT,
  module: MODULE,
  transverseModule: MODULE,
  pressureAngle: PRESSURE_ANGLE,
  transversePressureAngle: PRESSURE_ANGLE,
  helixAngle: HELIX_ANGLE,
  faceWidth: FACE_WIDTH,
  totalFaceWidth: FACE_WIDTH,
  centralRelief: CENTRAL_RELIEF,
  backlash: BACKLASH,
  contactMode: 'zero-backlash-ideal-rigid-contact',
  sunPitchRadius: SUN_PITCH_RADIUS,
  starPitchRadius: STAR_PITCH_RADIUS,
  ringPitchRadius: RING_PITCH_RADIUS,
  starOrbitRadius: STAR_ORBIT_RADIUS,
  sunStarCenterDistance: SUN_PITCH_RADIUS + STAR_PITCH_RADIUS,
  starRingCenterDistance: RING_PITCH_RADIUS - STAR_PITCH_RADIUS,
  ratio: ZR / ZS,
  starInitialPhase: STAR_PHASE,
  ringInitialPhase: RING_PHASE,
  sunBoreRadius: SUN_BORE_RADIUS,
  starBoreRadius: STAR_BORE_RADIUS,
  journalPinRadius: JOURNAL_PIN_RADIUS,
  inputShaftRadius: INPUT_SHAFT_RADIUS,
  outputShaftRadius: OUTPUT_SHAFT_RADIUS,
  carrierHubBoreRadius: CARRIER_HUB_BORE,
  sunHelixSign: 1,
  starHelixSign: -1,
  ringHelixSign: -1,
});

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const involute = (angle: number) => Math.tan(angle) - angle;

const polarPoint = (radius: number, angle: number) =>
  new THREE.Vector2(radius * Math.cos(angle), radius * Math.sin(angle));

function validateProfileArgs(
  teeth: number,
  internal: boolean,
  options: GearProfileOptions,
) {
  if (!Number.isInteger(teeth) || teeth < 3) {
    throw new RangeError('teeth must be an integer >= 3');
  }
  const module = options.module ?? MODULE;
  const pressureAngle = options.pressureAngle ?? PRESSURE_ANGLE;
  const backlash = options.backlash ?? BACKLASH;
  const addendum = options.addendum ?? module;
  const dedendum = options.dedendum ?? 1.25 * module;
  if (!(module > 0)) throw new RangeError('module must be positive');
  if (!(pressureAngle > 0 && pressureAngle < Math.PI / 2)) {
    throw new RangeError('pressureAngle must be between 0 and pi/2');
  }
  if (!(backlash >= 0)) throw new RangeError('backlash must be non-negative');
  if (!(addendum > 0 && dedendum > 0)) {
    throw new RangeError('addendum and dedendum must be positive');
  }
  if (internal && teeth <= 2)
    throw new RangeError('internal gear has too few teeth');
  return { module, pressureAngle, backlash, addendum, dedendum };
}

/**
 * Return a closed cyclic involute profile in the YZ plane as Vector2(y, z).
 * The first/last points are joined by the consumer; the array intentionally
 * avoids a duplicate seam point. Internal profiles are the inner boundary of
 * the ring, with radius increasing into the ring body.
 */
export function gearProfile(
  teeth: number,
  internal = false,
  options: GearProfileOptions = {},
): THREE.Vector2[] {
  const dimensions = validateProfileArgs(teeth, internal, options);
  const { module, pressureAngle, backlash, addendum, dedendum } = dimensions;
  const pitchRadius = (module * teeth) / 2;
  const baseRadius = pitchRadius * Math.cos(pressureAngle);
  const tipRadius = internal ? pitchRadius - addendum : pitchRadius + addendum;
  const rootRadius = internal ? pitchRadius + dedendum : pitchRadius - dedendum;
  const flankSamples = Math.max(3, Math.floor(options.samplesPerFlank ?? 8));
  const tipSamples = Math.max(2, Math.floor(options.samplesPerTip ?? 3));
  const rootSamples = Math.max(2, Math.floor(options.samplesPerRoot ?? 3));
  const toothPitch = (2 * Math.PI) / teeth;
  const halfPitchThickness =
    Math.PI / (2 * teeth) - backlash / (2 * pitchRadius);
  const phase = options.phase ?? 0;
  const baseDelta = internal
    ? halfPitchThickness - involute(pressureAngle)
    : halfPitchThickness + involute(pressureAngle);

  if (tipRadius <= 0 || rootRadius <= 0 || baseRadius <= 0) {
    throw new RangeError('profile radii must be positive');
  }
  if (!(halfPitchThickness > 0)) {
    throw new RangeError('backlash is too large for the selected tooth count');
  }

  // The involute polar offsets differ by mesh type. External tooth thickness
  // narrows with radius; an internal tooth's half-thickness grows toward the
  // ring root. The latter is the true internal involute relation requested by
  // the reducer contract.
  const flankDelta = (radius: number) => {
    const alpha = Math.acos(clamp(baseRadius / radius, 0, 1));
    return internal
      ? halfPitchThickness - involute(pressureAngle) + involute(alpha)
      : halfPitchThickness + involute(pressureAngle) - involute(alpha);
  };

  const points: THREE.Vector2[] = [];

  if (internal) {
    const tipDelta = flankDelta(Math.max(tipRadius, baseRadius));
    const rootDelta = flankDelta(Math.max(rootRadius, baseRadius));

    for (let tooth = 0; tooth < teeth; tooth += 1) {
      const center = phase + tooth * toothPitch;
      if (tooth === 0) points.push(polarPoint(rootRadius, center - rootDelta));

      // Inner ring boundary: root -> inward tip on the left flank.
      for (let sample = 1; sample <= flankSamples; sample += 1) {
        const u = sample / flankSamples;
        const radius = rootRadius + (tipRadius - rootRadius) * u;
        points.push(
          polarPoint(radius, center - flankDelta(Math.max(radius, baseRadius))),
        );
      }

      for (let sample = 1; sample <= tipSamples; sample += 1) {
        const angle = center - tipDelta + (2 * tipDelta * sample) / tipSamples;
        points.push(polarPoint(tipRadius, angle));
      }

      // Right flank: tip -> root. A tiny low-to-base transition is included
      // automatically for unusually small internal gears by clamping alpha.
      for (let sample = 1; sample <= flankSamples; sample += 1) {
        const u = sample / flankSamples;
        const radius = tipRadius + (rootRadius - tipRadius) * u;
        points.push(
          polarPoint(radius, center + flankDelta(Math.max(radius, baseRadius))),
        );
      }

      const nextLeftRoot = center + toothPitch - rootDelta;
      for (let sample = 1; sample <= rootSamples; sample += 1) {
        const angle =
          center +
          rootDelta +
          ((nextLeftRoot - center - rootDelta) * sample) / rootSamples;
        points.push(polarPoint(rootRadius, angle));
      }
    }
  } else {
    const tipDelta = flankDelta(tipRadius);

    for (let tooth = 0; tooth < teeth; tooth += 1) {
      const center = phase + tooth * toothPitch;
      if (tooth === 0) points.push(polarPoint(rootRadius, center - baseDelta));

      // External tooth boundary is traversed root -> tip on the left flank,
      // tip land, then tip -> root on the right flank.
      points.push(polarPoint(baseRadius, center - baseDelta));
      for (let sample = 1; sample <= flankSamples; sample += 1) {
        const u = sample / flankSamples;
        const radius = baseRadius + (tipRadius - baseRadius) * u;
        points.push(polarPoint(radius, center - flankDelta(radius)));
      }

      for (let sample = 1; sample <= tipSamples; sample += 1) {
        const angle = center - tipDelta + (2 * tipDelta * sample) / tipSamples;
        points.push(polarPoint(tipRadius, angle));
      }

      for (let sample = 1; sample < flankSamples; sample += 1) {
        const u = sample / flankSamples;
        const radius = tipRadius - (tipRadius - baseRadius) * u;
        points.push(polarPoint(radius, center + flankDelta(radius)));
      }
      points.push(polarPoint(baseRadius, center + baseDelta));
      points.push(polarPoint(rootRadius, center + baseDelta));

      const nextLeftRoot = center + toothPitch - baseDelta;
      for (let sample = 1; sample <= rootSamples; sample += 1) {
        const angle =
          center +
          baseDelta +
          ((nextLeftRoot - center - baseDelta) * sample) / rootSamples;
        points.push(polarPoint(rootRadius, angle));
      }
    }
  }

  return points;
}

function profileDimensions(teeth: number, internal: boolean) {
  const pitchRadius = (MODULE * teeth) / 2;
  return {
    pitchRadius,
    baseRadius: pitchRadius * Math.cos(PRESSURE_ANGLE),
    tipRadius: internal ? pitchRadius - MODULE : pitchRadius + MODULE,
    rootRadius: internal
      ? pitchRadius + 1.25 * MODULE
      : pitchRadius - 1.25 * MODULE,
  };
}

function transformProfilePoint(point: THREE.Vector2, angle: number, x: number) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    x,
    point.x * cosine - point.y * sine,
    point.x * sine + point.y * cosine,
  ];
}

function setGeometry(
  geometry: THREE.BufferGeometry,
  vertices: number[],
  indices: number[],
) {
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildExternalHalf(
  profile: THREE.Vector2[],
  pitchRadius: number,
  xStart: number,
  xEnd: number,
  helixSlope: number,
  slices: number,
  boreRadius = 0,
) {
  const vertices: number[] = [];
  const indices: number[] = [];
  const count = profile.length;
  const hasBore = boreRadius > 0;
  const stride = hasBore ? count * 2 : count + 1;
  let polygonArea = 0;
  for (let point = 0; point < count; point += 1) {
    const next = (point + 1) % count;
    polygonArea +=
      profile[point].x * profile[next].y - profile[next].x * profile[point].y;
  }
  const counterClockwise = polygonArea > 0;
  const phaseAt = (x: number) =>
    (helixSlope * Math.tan(HELIX_ANGLE) * x) / pitchRadius;

  for (let slice = 0; slice <= slices; slice += 1) {
    const x = xStart + ((xEnd - xStart) * slice) / slices;
    const phase = phaseAt(x);
    for (const point of profile)
      vertices.push(...transformProfilePoint(point, phase, x));
    if (hasBore) {
      // A gear bore is straight along X. The active involute rotates with the
      // helix, while this inner cylindrical surface remains concentric.
      for (const point of profile) {
        const angle = Math.atan2(point.y, point.x);
        vertices.push(
          x,
          boreRadius * Math.cos(angle),
          boreRadius * Math.sin(angle),
        );
      }
    } else {
      vertices.push(x, 0, 0);
    }
  }

  const index = (slice: number, point: number) => slice * stride + point;
  const boreIndex = (slice: number, point: number) =>
    slice * stride + count + point;
  for (let slice = 0; slice < slices; slice += 1) {
    for (let point = 0; point < count; point += 1) {
      const next = (point + 1) % count;
      const a = index(slice, point);
      const b = index(slice + 1, point);
      const c = index(slice + 1, next);
      const d = index(slice, next);
      if (counterClockwise) {
        indices.push(a, c, b, a, d, c);
      } else {
        indices.push(a, b, c, a, c, d);
      }
      if (hasBore) {
        const ia = boreIndex(slice, point);
        const ib = boreIndex(slice + 1, point);
        const ic = boreIndex(slice + 1, next);
        const id = boreIndex(slice, next);
        // The bore faces into the cavity, hence its winding is opposite the
        // outer profile for the same X direction.
        if (counterClockwise) {
          indices.push(ia, ib, ic, ia, ic, id);
        } else {
          indices.push(ia, ic, ib, ia, id, ic);
        }
      }
    }
  }

  if (hasBore) {
    for (let point = 0; point < count; point += 1) {
      const next = (point + 1) % count;
      const outerStart = index(0, point);
      const outerStartNext = index(0, next);
      const boreStart = boreIndex(0, point);
      const boreStartNext = boreIndex(0, next);
      const outerEnd = index(slices, point);
      const outerEndNext = index(slices, next);
      const boreEnd = boreIndex(slices, point);
      const boreEndNext = boreIndex(slices, next);
      if (counterClockwise) {
        // Left cap faces -X; right cap faces +X.
        indices.push(
          outerStart,
          boreStart,
          outerStartNext,
          boreStart,
          boreStartNext,
          outerStartNext,
        );
        indices.push(
          outerEnd,
          outerEndNext,
          boreEnd,
          outerEndNext,
          boreEndNext,
          boreEnd,
        );
      } else {
        indices.push(
          outerStart,
          outerStartNext,
          boreStart,
          outerStartNext,
          boreStartNext,
          boreStart,
        );
        indices.push(
          outerEnd,
          boreEnd,
          outerEndNext,
          outerEndNext,
          boreEnd,
          boreEndNext,
        );
      }
    }
  } else {
    const centerStart = index(0, count);
    const centerEnd = index(slices, count);
    for (let point = 0; point < count; point += 1) {
      const next = (point + 1) % count;
      if (counterClockwise) {
        indices.push(centerStart, index(0, next), index(0, point));
        indices.push(centerEnd, index(slices, point), index(slices, next));
      } else {
        indices.push(centerStart, index(0, point), index(0, next));
        indices.push(centerEnd, index(slices, next), index(slices, point));
      }
    }
  }

  return setGeometry(new THREE.BufferGeometry(), vertices, indices);
}

function buildInternalHalf(
  profile: THREE.Vector2[],
  pitchRadius: number,
  outerRadius: number,
  xStart: number,
  xEnd: number,
  helixSlope: number,
  slices: number,
) {
  const vertices: number[] = [];
  const indices: number[] = [];
  const count = profile.length;
  const stride = count * 2;
  let polygonArea = 0;
  for (let point = 0; point < count; point += 1) {
    const next = (point + 1) % count;
    polygonArea +=
      profile[point].x * profile[next].y - profile[next].x * profile[point].y;
  }
  const counterClockwise = polygonArea > 0;
  const phaseAt = (x: number) =>
    (helixSlope * Math.tan(HELIX_ANGLE) * x) / pitchRadius;

  for (let slice = 0; slice <= slices; slice += 1) {
    const x = xStart + ((xEnd - xStart) * slice) / slices;
    const phase = phaseAt(x);
    for (const point of profile)
      vertices.push(...transformProfilePoint(point, phase, x));
    for (const point of profile) {
      const angle = Math.atan2(point.y, point.x) + phase;
      vertices.push(
        x,
        outerRadius * Math.cos(angle),
        outerRadius * Math.sin(angle),
      );
    }
  }

  const inner = (slice: number, point: number) => slice * stride + point;
  const outer = (slice: number, point: number) =>
    slice * stride + count + point;
  for (let slice = 0; slice < slices; slice += 1) {
    for (let point = 0; point < count; point += 1) {
      const next = (point + 1) % count;
      const a = inner(slice, point);
      const b = inner(slice + 1, point);
      const c = inner(slice + 1, next);
      const d = inner(slice, next);
      const oa = outer(slice, point);
      const ob = outer(slice + 1, point);
      const oc = outer(slice + 1, next);
      const od = outer(slice, next);
      // The inner boundary faces the cavity; the outer cylinder faces away
      // from it. Both windings are explicit because their vertex order uses
      // opposite radial boundaries.
      if (counterClockwise) {
        indices.push(a, b, c, a, c, d);
        indices.push(oa, od, oc, oa, oc, ob);
      } else {
        indices.push(a, d, c, a, c, b);
        indices.push(oa, oc, od, oa, ob, oc);
      }
    }
  }

  for (let point = 0; point < count; point += 1) {
    const next = (point + 1) % count;
    // Annular end caps. DoubleSide is used by the material as this is also a
    // convenient cutaway mesh, but the winding remains consistent.
    if (counterClockwise) {
      indices.push(inner(0, point), outer(0, next), outer(0, point));
      indices.push(inner(0, point), inner(0, next), outer(0, next));
      indices.push(
        inner(slices, point),
        outer(slices, point),
        outer(slices, next),
      );
      indices.push(
        inner(slices, point),
        outer(slices, next),
        inner(slices, next),
      );
    } else {
      indices.push(inner(0, point), outer(0, point), outer(0, next));
      indices.push(inner(0, point), outer(0, next), inner(0, next));
      indices.push(
        inner(slices, point),
        outer(slices, next),
        outer(slices, point),
      );
      indices.push(
        inner(slices, point),
        inner(slices, next),
        outer(slices, next),
      );
    }
  }

  return setGeometry(new THREE.BufferGeometry(), vertices, indices);
}

function makeCylinderX(
  radius: number,
  depth: number,
  material: THREE.Material,
  segments = 32,
) {
  const geometry = new THREE.CylinderGeometry(radius, radius, depth, segments);
  geometry.rotateZ(Math.PI / 2);
  return new THREE.Mesh(geometry, material);
}

function makeTaperedCylinderX(
  startRadius: number,
  endRadius: number,
  xStart: number,
  xEnd: number,
  material: THREE.Material,
  segments = 64,
) {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const [x, radius] of [
    [xStart, startRadius],
    [xEnd, endRadius],
  ] as const) {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (2 * Math.PI * segment) / segments;
      vertices.push(x, radius * Math.cos(angle), radius * Math.sin(angle));
    }
  }
  const left = (segment: number) => (segment + segments) % segments;
  const right = (segment: number) =>
    segments + ((segment + segments) % segments);
  const leftCenter = vertices.length / 3;
  vertices.push(xStart, 0, 0);
  const rightCenter = vertices.length / 3;
  vertices.push(xEnd, 0, 0);
  for (let segment = 0; segment < segments; segment += 1) {
    const next = segment + 1 === segments ? 0 : segment + 1;
    // Outer frustum surface faces away from the axis.
    indices.push(
      left(segment),
      right(next),
      right(segment),
      left(segment),
      left(next),
      right(next),
    );
    // End caps face -X and +X respectively.
    indices.push(leftCenter, left(next), left(segment));
    indices.push(rightCenter, right(segment), right(next));
  }
  return setGeometry(new THREE.BufferGeometry(), vertices, indices);
}

function makeAnnulusX(
  innerRadius: number,
  outerRadius: number,
  depth: number,
  material: THREE.Material,
  segments = 96,
) {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const x of [-depth / 2, depth / 2]) {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (2 * Math.PI * segment) / segments;
      vertices.push(
        x,
        innerRadius * Math.cos(angle),
        innerRadius * Math.sin(angle),
      );
      vertices.push(
        x,
        outerRadius * Math.cos(angle),
        outerRadius * Math.sin(angle),
      );
    }
  }
  const ringIndex = (side: number, segment: number, outer: boolean) =>
    side * segments * 2 +
    ((segment + segments) % segments) * 2 +
    (outer ? 1 : 0);
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    const il = ringIndex(0, segment, false);
    const ir = ringIndex(0, next, false);
    const ol = ringIndex(0, segment, true);
    const or = ringIndex(0, next, true);
    const il2 = ringIndex(1, segment, false);
    const ir2 = ringIndex(1, next, false);
    const ol2 = ringIndex(1, segment, true);
    const or2 = ringIndex(1, next, true);
    // The angular vertex order is counter-clockwise in YZ. Reverse each
    // strip/cap triangle so the annulus normals face the solid material:
    // inward on the bore, outward on the OD, and away from each end face.
    indices.push(il, ir2, ir, il, il2, ir2);
    indices.push(ol, or, or2, ol, or2, ol2);
    indices.push(il, or, ol, il, ir, or);
    indices.push(il2, or2, ir2, il2, ol2, or2);
  }
  return setGeometry(new THREE.BufferGeometry(), vertices, indices);
}

function material(color: number) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.86,
    roughness: 0.24,
    side: THREE.DoubleSide,
  });
}

function tag<T extends THREE.Object3D>(
  object: T,
  data: Record<string, unknown>,
): T {
  object.userData = { ...object.userData, ...data };
  return object;
}

interface GearBuildOptions {
  id: string;
  teeth: number;
  internal: boolean;
  helixSign: number;
  color: number;
  slices: number;
  initialPhase: number;
  boreRadius?: number;
}

function buildGear({
  id,
  teeth,
  internal,
  helixSign,
  color,
  slices,
  initialPhase,
  boreRadius = 0,
}: GearBuildOptions) {
  const dimensions = profileDimensions(teeth, internal);
  const profile = gearProfile(teeth, internal, {
    phase: 0,
    samplesPerFlank: MESH_FLANK_SAMPLES,
    samplesPerTip: MESH_TIP_SAMPLES,
    samplesPerRoot: MESH_ROOT_SAMPLES,
  });
  const vertexStride =
    internal || boreRadius > 0 ? profile.length * 2 : profile.length + 1;
  const gear = tag(new THREE.Group(), {
    partId: 'gear',
    gearId: id,
    toothCount: teeth,
    internal,
    boreRadius,
    pitchRadius: dimensions.pitchRadius,
    helixSign,
    initialPhase,
    profile,
  });
  const gearMaterial = material(color);
  const halfStart = -FACE_WIDTH / 2;
  const halfEnd = -CENTRAL_RELIEF / 2;
  const rightStart = CENTRAL_RELIEF / 2;
  const rightEnd = FACE_WIDTH / 2;
  const halfPieces = [
    { xStart: halfStart, xEnd: halfEnd, side: -1 },
    { xStart: rightStart, xEnd: rightEnd, side: 1 },
  ];

  for (const half of halfPieces) {
    const helixSlope = helixSign * half.side;
    const geometry = internal
      ? buildInternalHalf(
          profile,
          dimensions.pitchRadius,
          dimensions.pitchRadius + 3 * MODULE,
          half.xStart,
          half.xEnd,
          helixSlope,
          slices,
        )
      : buildExternalHalf(
          profile,
          dimensions.pitchRadius,
          half.xStart,
          half.xEnd,
          helixSlope,
          slices,
          boreRadius,
        );
    geometry.userData = {
      profile,
      profilePointCount: profile.length,
      vertexStride,
      boreRadius,
      pitchRadius: dimensions.pitchRadius,
      xStart: half.xStart,
      xEnd: half.xEnd,
      helixSlope,
      helixAngle: HELIX_ANGLE,
      internal,
    };
    const mesh = tag(new THREE.Mesh(geometry, gearMaterial), {
      partId: 'gear',
      gearId: id,
      component: 'double-helical-half',
      side: half.side < 0 ? 'left' : 'right',
      toothCount: teeth,
      internal,
      boreRadius,
      pitchRadius: dimensions.pitchRadius,
      helixSign,
      helixSlope,
      initialPhase,
      profile,
      profilePointCount: profile.length,
      vertexStride,
      xStart: half.xStart,
      xEnd: half.xEnd,
    });
    gear.add(mesh);
  }

  const bridge = internal
    ? new THREE.Mesh(
        makeAnnulusX(
          dimensions.rootRadius,
          dimensions.pitchRadius + 3 * MODULE,
          CENTRAL_RELIEF,
          gearMaterial,
        ),
        gearMaterial,
      )
    : boreRadius > 0
      ? new THREE.Mesh(
          makeAnnulusX(
            boreRadius,
            dimensions.rootRadius,
            CENTRAL_RELIEF,
            gearMaterial,
          ),
          gearMaterial,
        )
      : makeCylinderX(dimensions.rootRadius, CENTRAL_RELIEF, gearMaterial);
  tag(bridge, {
    partId: 'gear',
    gearId: id,
    component: 'central-relief-bridge',
    toothCount: teeth,
    internal,
    boreRadius,
    pitchRadius: dimensions.pitchRadius,
  });
  gear.add(bridge);

  const marker = tag(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.0032, 12, 8),
      new THREE.MeshStandardMaterial({
        color: 0xffd75e,
        emissive: 0x8a5c00,
        emissiveIntensity: 1.4,
        metalness: 0.2,
        roughness: 0.25,
      }),
    ),
    { partId: 'gear', gearId: id, component: 'highlight' },
  );
  marker.visible = false;
  gear.add(marker);

  const updateHighlight = (toothIndex: number | null) => {
    const normalized =
      toothIndex === null
        ? null
        : ((Math.trunc(toothIndex) % teeth) + teeth) % teeth;
    gear.userData.highlightedTooth = normalized;
    marker.visible = normalized !== null;
    if (normalized !== null) {
      const angle = (2 * Math.PI * normalized) / teeth;
      const radius = internal ? dimensions.tipRadius : dimensions.tipRadius;
      marker.position.set(
        -FACE_WIDTH / 2 - 0.002,
        radius * Math.cos(angle),
        radius * Math.sin(angle),
      );
    }
  };
  updateHighlight(null);
  return { gear, updateHighlight };
}

function addShaft(
  parent: THREE.Group,
  id: string,
  x: number,
  radius: number,
  length: number,
  color: number,
) {
  const xStart = x - length / 2;
  const xEnd = x + length / 2;
  const shaft = tag(new THREE.Group(), {
    partId: 'shaft',
    shaftId: id,
    attachable: true,
    xStart,
    xEnd,
    radius,
  });
  const mesh = tag(makeCylinderX(radius, length, material(color)), {
    partId: 'shaft',
    shaftId: id,
    attachable: true,
    xStart,
    xEnd,
    radius,
  });
  mesh.position.x = x;
  shaft.add(mesh);
  parent.add(shaft);
  return shaft;
}

function addCarrier(carrier: THREE.Group) {
  const carrierMaterial = material(0x28323b);
  const plateThickness = 0.004;
  const spokeInnerRadius = CARRIER_HUB_OUTER - 0.001;
  const spokeOuterRadius = STAR_ORBIT_RADIUS + JOURNAL_PIN_RADIUS;
  const spokeWidth = 0.012;
  const spokeLength = spokeOuterRadius - spokeInnerRadius;
  // The ring output drum occupies the fan-side (negative-X) region. Keep the
  // fixed carrier frame on the aft side of the gear faces so it cannot pass
  // through that rotating drum; the pins still run through the star bores.
  const plateX = FACE_WIDTH / 2 + 0.006;
  carrier.userData.supportX = plateX;
  const centralPlate = new THREE.Mesh(
    makeAnnulusX(
      CARRIER_HUB_BORE,
      CARRIER_HUB_OUTER,
      plateThickness,
      carrierMaterial,
      64,
    ),
    carrierMaterial,
  );
  centralPlate.position.x = plateX;
  tag(centralPlate, {
    partId: 'carrier',
    component: 'support-plate',
    region: 'hub-annulus',
    fixed: true,
    boreRadius: CARRIER_HUB_BORE,
    xStart: plateX - plateThickness / 2,
    xEnd: plateX + plateThickness / 2,
  });
  carrier.add(centralPlate);

  const outerPlate = new THREE.Mesh(
    makeAnnulusX(
      CARRIER_OUTER_RING_INNER,
      CARRIER_OUTER_RING_OUTER,
      plateThickness,
      carrierMaterial,
      64,
    ),
    carrierMaterial,
  );
  outerPlate.position.x = plateX;
  tag(outerPlate, {
    partId: 'carrier',
    component: 'support-plate',
    region: 'journal-ring',
    fixed: true,
    xStart: plateX - plateThickness / 2,
    xEnd: plateX + plateThickness / 2,
  });
  carrier.add(outerPlate);

  for (let index = 0; index < STAR_COUNT; index += 1) {
    const angle = (2 * Math.PI * index) / STAR_COUNT;
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(plateThickness, spokeLength, spokeWidth),
      carrierMaterial,
    );
    spoke.position.set(
      plateX,
      (spokeInnerRadius + spokeOuterRadius) * 0.5 * Math.cos(angle),
      (spokeInnerRadius + spokeOuterRadius) * 0.5 * Math.sin(angle),
    );
    spoke.rotation.x = angle;
    tag(spoke, {
      partId: 'carrier',
      component: 'carrier-spoke',
      spokeIndex: index,
      fixed: true,
      xStart: plateX - plateThickness / 2,
      xEnd: plateX + plateThickness / 2,
    });
    carrier.add(spoke);
  }
  const hub = new THREE.Mesh(
    makeAnnulusX(
      CARRIER_HUB_BORE,
      CARRIER_HUB_OUTER,
      plateThickness,
      carrierMaterial,
      64,
    ),
    carrierMaterial,
  );
  hub.position.x = plateX;
  tag(hub, {
    partId: 'carrier',
    component: 'fixed-hub',
    fixed: true,
    boreRadius: CARRIER_HUB_BORE,
    xStart: plateX - plateThickness / 2,
    xEnd: plateX + plateThickness / 2,
  });
  carrier.add(hub);

  const pinDepth = FACE_WIDTH + 0.008;
  const pinCenterX = 0.004;
  for (let index = 0; index < STAR_COUNT; index += 1) {
    const angle = (2 * Math.PI * index) / STAR_COUNT;
    const pin = makeCylinderX(
      JOURNAL_PIN_RADIUS,
      pinDepth,
      carrierMaterial,
      24,
    );
    pin.position.set(
      pinCenterX,
      STAR_ORBIT_RADIUS * Math.cos(angle),
      STAR_ORBIT_RADIUS * Math.sin(angle),
    );
    tag(pin, {
      partId: 'carrier',
      component: 'journal-pin',
      journalIndex: index,
      radius: JOURNAL_PIN_RADIUS,
      xStart: -FACE_WIDTH / 2,
      xEnd: FACE_WIDTH / 2 + 0.008,
      fixed: true,
    });
    carrier.add(pin);
  }
}

export function deriveGearAngles(lpAngle: number): GearAngles {
  const sun = lpAngle;
  const ring = -((ZS / ZR) * lpAngle) + RING_PHASE;
  const stars = Array.from(
    { length: STAR_COUNT },
    () => -((ZS / ZP) * lpAngle) + STAR_PHASE,
  );
  return {
    sun,
    stars,
    ring,
    carrier: 0,
    sunAngle: sun,
    starAngles: stars,
    ringAngle: ring,
  };
}

export function createGearbox(options: GearboxOptions = {}): Gearbox {
  const slices = Math.max(2, Math.floor(options.helixSlices ?? 6));
  const group = tag(new THREE.Group(), {
    partId: 'gearbox',
    axis: '+X',
    radialPlane: 'YZ',
    illustrative: true,
    toothCounts: { sun: ZS, star: ZP, ring: ZR },
  });
  const carrier = tag(new THREE.Group(), { partId: 'carrier', fixed: true });
  addCarrier(carrier);

  const sunBuild = buildGear({
    id: 'sun',
    teeth: ZS,
    internal: false,
    helixSign: 1,
    color: 0xb98238,
    slices,
    initialPhase: 0,
    boreRadius: SUN_BORE_RADIUS,
  });
  const sun = sunBuild.gear;
  const inputShaft = addShaft(
    sun,
    'input',
    0.1,
    INPUT_SHAFT_RADIUS,
    0.24,
    0xa7adb4,
  );
  const inputSplineMaterial = material(0x9ea7af);
  const inputSplineSleeve = tag(
    new THREE.Mesh(
      makeAnnulusX(
        INPUT_SHAFT_RADIUS,
        SUN_BORE_RADIUS,
        FACE_WIDTH,
        inputSplineMaterial,
        64,
      ),
      inputSplineMaterial,
    ),
    {
      partId: 'gear',
      gearId: 'sun',
      component: 'input-spline-sleeve',
      innerRadius: INPUT_SHAFT_RADIUS,
      outerRadius: SUN_BORE_RADIUS,
      xStart: -FACE_WIDTH / 2,
      xEnd: FACE_WIDTH / 2,
      attachable: true,
    },
  );
  sun.add(inputSplineSleeve);

  const stars: THREE.Group[] = [];
  const starBuilds: Array<{ updateHighlight: (index: number | null) => void }> =
    [];
  for (let index = 0; index < STAR_COUNT; index += 1) {
    const built = buildGear({
      id: `star-${index}`,
      teeth: ZP,
      internal: false,
      helixSign: -1,
      color: 0xd6dce2,
      slices,
      initialPhase: STAR_PHASE,
      boreRadius: STAR_BORE_RADIUS,
    });
    const angle = (2 * Math.PI * index) / STAR_COUNT;
    built.gear.position.set(
      0,
      STAR_ORBIT_RADIUS * Math.cos(angle),
      STAR_ORBIT_RADIUS * Math.sin(angle),
    );
    built.gear.userData.orbitIndex = index;
    built.gear.userData.orbitAngle = angle;
    const journalSleeveMaterial = material(0xb8c1c8);
    const journalSleeve = tag(
      new THREE.Mesh(
        makeAnnulusX(
          JOURNAL_PIN_RADIUS,
          STAR_BORE_RADIUS,
          FACE_WIDTH,
          journalSleeveMaterial,
          48,
        ),
        journalSleeveMaterial,
      ),
      {
        partId: 'gear',
        gearId: `star-${index}`,
        component: 'journal-sleeve',
        innerRadius: JOURNAL_PIN_RADIUS,
        outerRadius: STAR_BORE_RADIUS,
        journalIndex: index,
        xStart: -FACE_WIDTH / 2,
        xEnd: FACE_WIDTH / 2,
        attachable: true,
      },
    );
    built.gear.add(journalSleeve);
    stars.push(built.gear);
    starBuilds.push({ updateHighlight: built.updateHighlight });
  }

  const ringBuild = buildGear({
    id: 'ring',
    teeth: ZR,
    internal: true,
    helixSign: -1,
    color: 0x159ca7,
    slices,
    initialPhase: RING_PHASE,
  });
  const ring = ringBuild.gear;
  const flangeMaterial = material(0x159ca7);
  const outputDrum = tag(
    new THREE.Mesh(
      makeTaperedCylinderX(
        OUTPUT_SHAFT_RADIUS,
        RING_PITCH_RADIUS + 3 * MODULE,
        -0.13,
        -FACE_WIDTH / 2,
        flangeMaterial,
        96,
      ),
      flangeMaterial,
    ),
    {
      partId: 'gear',
      gearId: 'ring',
      component: 'output-drum',
      xStart: -0.13,
      xEnd: -FACE_WIDTH / 2,
      radiusAtShaft: OUTPUT_SHAFT_RADIUS,
      radiusAtRing: RING_PITCH_RADIUS + 3 * MODULE,
    },
  );
  ring.add(outputDrum);
  const outputFlange = makeAnnulusX(
    OUTPUT_SHAFT_RADIUS,
    OUTPUT_SHAFT_RADIUS + 0.02,
    0.012,
    flangeMaterial,
    64,
  );
  const flangeMesh = tag(new THREE.Mesh(outputFlange, flangeMaterial), {
    partId: 'gear',
    gearId: 'ring',
    component: 'output-flange',
    xStart: -0.166,
    xEnd: -0.154,
  });
  flangeMesh.position.x = -0.16;
  ring.add(flangeMesh);
  const outputShaft = addShaft(
    ring,
    'output',
    -0.135,
    OUTPUT_SHAFT_RADIUS,
    0.17,
    0x8e979f,
  );

  group.add(carrier, sun, ...stars, ring);
  const setAngle = (lpAngle: number) => {
    const angles = deriveGearAngles(lpAngle);
    sun.rotation.x = angles.sun;
    ring.rotation.x = angles.ring;
    stars.forEach((star, index) => {
      star.rotation.x = angles.stars[index];
    });
    group.userData.lpAngle = lpAngle;
    group.userData.angles = angles;
    const rotationIndex = Math.floor((lpAngle / (2 * Math.PI)) * ZS);
    group.userData.rotationIndex = ((rotationIndex % ZS) + ZS) % ZS;
  };
  const setHighlight = (toothIndex: number | null) => {
    sunBuild.updateHighlight(toothIndex);
    starBuilds.forEach((built) => built.updateHighlight(toothIndex));
    ringBuild.updateHighlight(toothIndex);
    group.userData.highlightedTooth = toothIndex;
  };
  const setRotationIndex = (rotationIndex: number | null) => {
    const normalized =
      rotationIndex === null
        ? null
        : ((Math.trunc(rotationIndex) % ZS) + ZS) % ZS;
    group.userData.rotationIndex = normalized;
    setHighlight(normalized);
  };

  const gearbox: Gearbox = {
    group,
    sun,
    stars,
    ring,
    carrier,
    inputShaft,
    outputShaft,
    setAngle,
    setHighlight,
    setRotationIndex,
  };
  setAngle(0);
  setHighlight(options.highlightTooth ?? null);
  return gearbox;
}
