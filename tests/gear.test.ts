import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  GEAR,
  createGearbox,
  deriveGearAngles,
  gearProfile,
} from '../lib/gear.ts';

const cross = (a: THREE.Vector2, b: THREE.Vector2) => a.x * b.y - a.y * b.x;

function rayBoundary(
  profile: THREE.Vector2[],
  angle: number,
  internal: boolean,
) {
  const unit = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
  let boundary = internal ? Number.POSITIVE_INFINITY : 0;
  for (let index = 0; index < profile.length; index += 1) {
    const start = profile[index];
    const end = profile[(index + 1) % profile.length];
    const edge = end.clone().sub(start);
    const denominator = cross(edge, unit);
    if (Math.abs(denominator) < 1e-12) continue;
    const edgeFraction = -cross(start, unit) / denominator;
    if (edgeFraction < -1e-9 || edgeFraction > 1 + 1e-9) continue;
    const hit = start.clone().addScaledVector(edge, edgeFraction);
    const radius = hit.dot(unit);
    if (radius > 0 && (internal ? radius < boundary : radius > boundary))
      boundary = radius;
  }
  assert.ok(Number.isFinite(boundary), `ray ${angle} did not meet profile`);
  return boundary;
}

interface RadialBoundaryIndex {
  profile: THREE.Vector2[];
  binCount: number;
  bins: Map<number, PolygonEdge[]>;
}

function indexRadialBoundary(
  profile: THREE.Vector2[],
  binCount = 720,
): RadialBoundaryIndex {
  const bins = new Map<number, PolygonEdge[]>();
  const addToBin = (bin: number, edge: PolygonEdge) => {
    const normalized = (bin + binCount) % binCount;
    const bucket = bins.get(normalized);
    if (bucket) bucket.push(edge);
    else bins.set(normalized, [edge]);
  };
  for (let index = 0; index < profile.length; index += 1) {
    const edge: PolygonEdge = [
      profile[index],
      profile[(index + 1) % profile.length],
    ];
    const startAngle = Math.atan2(edge[0].y, edge[0].x);
    const delta = wrap(Math.atan2(edge[1].y, edge[1].x) - startAngle);
    const endAngle = startAngle + delta;
    const firstBin = Math.floor(
      (Math.min(startAngle, endAngle) / (2 * Math.PI)) * binCount,
    );
    const lastBin = Math.ceil(
      (Math.max(startAngle, endAngle) / (2 * Math.PI)) * binCount,
    );
    // Include a neighboring bin at both ends so a ray exactly on a vertex
    // still sees the edge after Float32 quantization.
    for (let bin = firstBin - 1; bin <= lastBin + 1; bin += 1)
      addToBin(bin, edge);
  }
  return { profile, binCount, bins };
}

function indexedRayBoundary(
  index: RadialBoundaryIndex,
  angle: number,
  internal: boolean,
) {
  const unit = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
  let boundary = internal ? Number.POSITIVE_INFINITY : 0;
  const normalized = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const bucket =
    Math.floor((normalized / (2 * Math.PI)) * index.binCount) % index.binCount;
  for (const [start, end] of index.bins.get(bucket) ?? []) {
    const edge = end.clone().sub(start);
    const denominator = cross(edge, unit);
    if (Math.abs(denominator) < 1e-12) continue;
    const edgeFraction = -cross(start, unit) / denominator;
    if (edgeFraction < -1e-9 || edgeFraction > 1 + 1e-9) continue;
    const hit = start.clone().addScaledVector(edge, edgeFraction);
    const radius = hit.dot(unit);
    if (radius > 0 && (internal ? radius < boundary : radius > boundary))
      boundary = radius;
  }
  assert.ok(
    Number.isFinite(boundary),
    `indexed ray ${angle} did not meet profile`,
  );
  return boundary;
}

function wrap(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function toothOffset(angle: number, teeth: number) {
  const pitch = (2 * Math.PI) / teeth;
  return Math.abs(wrap(angle - Math.round(angle / pitch) * pitch));
}

function polarPoint(radius: number, angle: number) {
  return new THREE.Vector2(radius * Math.cos(angle), radius * Math.sin(angle));
}

function pointOnSegment(
  point: THREE.Vector2,
  start: THREE.Vector2,
  end: THREE.Vector2,
) {
  const edge = end.clone().sub(start);
  const fromStart = point.clone().sub(start);
  const lengthSquared = edge.lengthSq();
  if (lengthSquared === 0) return point.distanceTo(start) < 1e-9;
  const crossValue = cross(edge, fromStart);
  if (Math.abs(crossValue) > 1e-10) return false;
  const projection = fromStart.dot(edge) / lengthSquared;
  return projection >= -1e-9 && projection <= 1 + 1e-9;
}

type PolygonEdge = [THREE.Vector2, THREE.Vector2];

interface IndexedEdge {
  start: THREE.Vector2;
  end: THREE.Vector2;
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
  id: number;
}

interface PolygonIndex {
  polygon: THREE.Vector2[];
  minimumY: number;
  maximumY: number;
  buckets: PolygonEdge[][];
}

function indexPolygon(
  polygon: THREE.Vector2[],
  bucketCount = 96,
): PolygonIndex {
  const minimumY = Math.min(...polygon.map((point) => point.y));
  const maximumY = Math.max(...polygon.map((point) => point.y));
  const range = Math.max(maximumY - minimumY, 1e-12);
  const buckets: PolygonEdge[][] = Array.from(
    { length: bucketCount },
    () => [],
  );
  const bucketFor = (y: number) =>
    Math.max(
      0,
      Math.min(
        bucketCount - 1,
        Math.floor(((y - minimumY) / range) * bucketCount),
      ),
    );
  for (let index = 0; index < polygon.length; index += 1) {
    const edge: PolygonEdge = [
      polygon[index],
      polygon[(index + 1) % polygon.length],
    ];
    const firstBucket = bucketFor(Math.min(edge[0].y, edge[1].y));
    const lastBucket = bucketFor(Math.max(edge[0].y, edge[1].y));
    for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1)
      buckets[bucket].push(edge);
  }
  return { polygon, minimumY, maximumY, buckets };
}

function indexedPointInPolygon(point: THREE.Vector2, index: PolygonIndex) {
  if (point.y < index.minimumY - 1e-10 || point.y > index.maximumY + 1e-10)
    return false;
  const range = Math.max(index.maximumY - index.minimumY, 1e-12);
  const bucket = Math.max(
    0,
    Math.min(
      index.buckets.length - 1,
      Math.floor(((point.y - index.minimumY) / range) * index.buckets.length),
    ),
  );
  let inside = false;
  for (const [start, end] of index.buckets[bucket]) {
    if (pointOnSegment(point, start, end)) return true;
    if (
      start.y > point.y !== end.y > point.y &&
      point.x <
        ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function indexedStrictInside(point: THREE.Vector2, index: PolygonIndex) {
  if (!indexedPointInPolygon(point, index)) return false;
  const range = Math.max(index.maximumY - index.minimumY, 1e-12);
  const bucket = Math.max(
    0,
    Math.min(
      index.buckets.length - 1,
      Math.floor(((point.y - index.minimumY) / range) * index.buckets.length),
    ),
  );
  return !index.buckets[bucket].some(([start, end]) =>
    pointOnSegment(point, start, end),
  );
}

interface EdgeIndex {
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
  bucketCount: number;
  buckets: Map<number, IndexedEdge[]>;
  edgeCount: number;
}

function indexEdges(polygon: THREE.Vector2[], bucketCount = 96): EdgeIndex {
  const minimumX = Math.min(...polygon.map((point) => point.x));
  const maximumX = Math.max(...polygon.map((point) => point.x));
  const minimumY = Math.min(...polygon.map((point) => point.y));
  const maximumY = Math.max(...polygon.map((point) => point.y));
  const rangeX = Math.max(maximumX - minimumX, 1e-12);
  const rangeY = Math.max(maximumY - minimumY, 1e-12);
  const buckets = new Map<number, IndexedEdge[]>();
  const bucketForX = (x: number) =>
    Math.max(
      0,
      Math.min(
        bucketCount - 1,
        Math.floor(((x - minimumX) / rangeX) * bucketCount),
      ),
    );
  const bucketForY = (y: number) =>
    Math.max(
      0,
      Math.min(
        bucketCount - 1,
        Math.floor(((y - minimumY) / rangeY) * bucketCount),
      ),
    );
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const edge: IndexedEdge = {
      start,
      end,
      minimumX: Math.min(start.x, end.x),
      maximumX: Math.max(start.x, end.x),
      minimumY: Math.min(start.y, end.y),
      maximumY: Math.max(start.y, end.y),
      id: index,
    };
    const firstX = bucketForX(edge.minimumX);
    const lastX = bucketForX(edge.maximumX);
    const firstY = bucketForY(edge.minimumY);
    const lastY = bucketForY(edge.maximumY);
    for (let xBucket = firstX; xBucket <= lastX; xBucket += 1)
      for (let yBucket = firstY; yBucket <= lastY; yBucket += 1) {
        const key = yBucket * bucketCount + xBucket;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(edge);
        else buckets.set(key, [edge]);
      }
  }
  return {
    minimumX,
    maximumX,
    minimumY,
    maximumY,
    bucketCount,
    buckets,
    edgeCount: polygon.length,
  };
}

function segmentCrossingDepth(
  firstStart: THREE.Vector2,
  firstEnd: THREE.Vector2,
  secondStart: THREE.Vector2,
  secondEnd: THREE.Vector2,
) {
  if (!strictlyCrosses(firstStart, firstEnd, secondStart, secondEnd)) return 0;
  const first = firstEnd.clone().sub(firstStart);
  const second = secondEnd.clone().sub(secondStart);
  const offset = secondStart.clone().sub(firstStart);
  const denominator = cross(first, second);
  const firstFraction = cross(offset, second) / denominator;
  const secondFraction = cross(offset, first) / denominator;
  return Math.min(
    firstFraction * first.length(),
    (1 - firstFraction) * first.length(),
    secondFraction * second.length(),
    (1 - secondFraction) * second.length(),
  );
}

function polygonEdgesIntersect(first: THREE.Vector2[], second: EdgeIndex) {
  const rangeX = Math.max(second.maximumX - second.minimumX, 1e-12);
  const rangeY = Math.max(second.maximumY - second.minimumY, 1e-12);
  const bucketCount = second.bucketCount;
  const bucketForX = (x: number) =>
    Math.max(
      0,
      Math.min(
        bucketCount - 1,
        Math.floor(((x - second.minimumX) / rangeX) * bucketCount),
      ),
    );
  const bucketForY = (y: number) =>
    Math.max(
      0,
      Math.min(
        bucketCount - 1,
        Math.floor(((y - second.minimumY) / rangeY) * bucketCount),
      ),
    );
  const seen = new Uint32Array(second.edgeCount);
  let stamp = 0;
  let maximumDepth = 0;
  for (let index = 0; index < first.length; index += 1) {
    const start = first[index];
    const end = first[(index + 1) % first.length];
    const minimumX = Math.min(start.x, end.x);
    const maximumX = Math.max(start.x, end.x);
    const minimumY = Math.max(second.minimumY, Math.min(start.y, end.y));
    const maximumY = Math.min(second.maximumY, Math.max(start.y, end.y));
    if (minimumY > maximumY) continue;
    stamp += 1;
    for (
      let xBucket = bucketForX(minimumX);
      xBucket <= bucketForX(maximumX);
      xBucket += 1
    )
      for (
        let yBucket = bucketForY(minimumY);
        yBucket <= bucketForY(maximumY);
        yBucket += 1
      )
        for (const candidate of second.buckets.get(
          yBucket * bucketCount + xBucket,
        ) ?? []) {
          if (seen[candidate.id] === stamp) continue;
          seen[candidate.id] = stamp;
          if (
            candidate.maximumX < minimumX - 1e-12 ||
            candidate.minimumX > maximumX + 1e-12 ||
            candidate.maximumY < minimumY - 1e-12 ||
            candidate.minimumY > maximumY + 1e-12
          )
            continue;
          maximumDepth = Math.max(
            maximumDepth,
            segmentCrossingDepth(start, end, candidate.start, candidate.end),
          );
        }
  }
  return maximumDepth;
}

function flankNormalAlignment(
  profile: THREE.Vector2[],
  pitchRadius: number,
  expected: THREE.Vector2,
) {
  let best = 0;
  for (let index = 0; index < profile.length; index += 1) {
    const start = profile[index];
    const end = profile[(index + 1) % profile.length];
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    if (Math.abs(midpoint.length() - pitchRadius) > 0.0015) continue;
    const tangent = end.clone().sub(start).normalize();
    const normal = new THREE.Vector2(-tangent.y, tangent.x);
    best = Math.max(best, Math.abs(normal.dot(expected)));
  }
  return best;
}

function strictlyCrosses(
  firstStart: THREE.Vector2,
  firstEnd: THREE.Vector2,
  secondStart: THREE.Vector2,
  secondEnd: THREE.Vector2,
) {
  const first = firstEnd.clone().sub(firstStart);
  const second = secondEnd.clone().sub(secondStart);
  const a = cross(first, secondStart.clone().sub(firstStart));
  const b = cross(first, secondEnd.clone().sub(firstStart));
  const c = cross(second, firstStart.clone().sub(secondStart));
  const d = cross(second, firstEnd.clone().sub(secondStart));
  // A crossing at this scale is the round-off/tessellation error of two
  // involute chords meeting at the theoretical contact point, not a finite
  // solid overlap. The separate contact-error assertion below bounds it.
  const epsilon = 1e-9;
  return (
    ((a > epsilon && b < -epsilon) || (a < -epsilon && b > epsilon)) &&
    ((c > epsilon && d < -epsilon) || (c < -epsilon && d > epsilon))
  );
}

function meshSlicePolygon(gear: THREE.Group, mesh: THREE.Mesh, slice: number) {
  const count = mesh.userData.profilePointCount as number;
  const vertexStride = mesh.userData.vertexStride as number;
  const positions = mesh.geometry.getAttribute('position');
  const center = new THREE.Vector2(gear.position.y, gear.position.z);
  const polygon: THREE.Vector2[] = [];
  for (let point = 0; point < count; point += 1) {
    const vertex = slice * vertexStride + point;
    polygon.push(
      new THREE.Vector2(positions.getY(vertex), positions.getZ(vertex))
        .rotateAround(new THREE.Vector2(), gear.rotation.x)
        .add(center),
    );
  }
  return polygon;
}

function meshSliceAngle(
  gear: THREE.Group,
  mesh: THREE.Mesh,
  slice: number,
  pitchRadius: number,
) {
  const vertexStride = mesh.userData.vertexStride as number;
  const positions = mesh.geometry.getAttribute('position');
  const x = positions.getX(slice * vertexStride);
  return (
    gear.rotation.x +
    (mesh.userData.helixSlope * Math.tan(GEAR.helixAngle) * x) / pitchRadius
  );
}

// Float32 mesh vertices and straight chords approximate the analytic
// involutes. A positive depth below means a sampled vertex is on the other
// gear's solid side of its radial boundary. Keep this allowance at 20 um;
// it is below 0.5% of the illustrative module and is checked at every slice.
const MAX_TESSELLATION_ERROR = 0.00002;

function maximumSolidPenetration(
  points: THREE.Vector2[],
  center: THREE.Vector2,
  boundaryPolygon: THREE.Vector2[] | RadialBoundaryIndex,
  internal: boolean,
) {
  let maximum = 0;
  for (const point of points) {
    const local = point.clone().sub(center);
    const radius = local.length();
    const boundary =
      'bins' in boundaryPolygon
        ? indexedRayBoundary(
            boundaryPolygon,
            Math.atan2(local.y, local.x),
            internal,
          )
        : rayBoundary(boundaryPolygon, Math.atan2(local.y, local.x), internal);
    // For an internal ring, material starts outside the cavity boundary. For
    // an external gear, material occupies the radial interval up to its
    // outer boundary.
    const penetration = internal ? radius - boundary : boundary - radius;
    maximum = Math.max(maximum, penetration);
  }
  return maximum;
}

function pointToPolygonDistance(
  point: THREE.Vector2,
  polygon: THREE.Vector2[],
) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const edgeX = end.x - start.x;
    const edgeY = end.y - start.y;
    const lengthSquared = edgeX * edgeX + edgeY * edgeY;
    const pointX = point.x - start.x;
    const pointY = point.y - start.y;
    const fraction =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, (pointX * edgeX + pointY * edgeY) / lengthSquared),
          );
    const dx = pointX - fraction * edgeX;
    const dy = pointY - fraction * edgeY;
    minimum = Math.min(minimum, Math.hypot(dx, dy));
  }
  return minimum;
}

function theoreticalFlankPoint(
  teeth: number,
  internal: boolean,
  radius: number,
  side: -1 | 1,
  toothCenter: number,
) {
  const pitchRadius = (GEAR.module * teeth) / 2;
  const baseRadius = pitchRadius * Math.cos(GEAR.transversePressureAngle);
  const halfPitchThickness = Math.PI / (2 * teeth);
  const alpha = Math.acos(baseRadius / radius);
  const involuteAt = (value: number) => Math.tan(value) - value;
  const delta = internal
    ? halfPitchThickness -
      involuteAt(GEAR.transversePressureAngle) +
      involuteAt(alpha)
    : halfPitchThickness +
      involuteAt(GEAR.transversePressureAngle) -
      involuteAt(alpha);
  return polarPoint(radius, toothCenter + side * delta);
}

function externalMeshContactCandidates(lpAngle: number, orbitAngle: number) {
  const pitchRadius = GEAR.sunPitchRadius;
  const baseRadius = pitchRadius * Math.cos(GEAR.transversePressureAngle);
  const tipRadius = pitchRadius + GEAR.module;
  const halfPitchThickness = Math.PI / (2 * GEAR.Zs);
  const toothPitch = (2 * Math.PI) / GEAR.Zs;
  const radial = polarPoint(1, orbitAngle);
  const tangent = new THREE.Vector2(-radial.y, radial.x);
  const normal = radial
    .clone()
    .multiplyScalar(Math.sin(GEAR.transversePressureAngle))
    .add(
      tangent.clone().multiplyScalar(Math.cos(GEAR.transversePressureAngle)),
    );
  const pitchPoint = radial.clone().multiplyScalar(pitchRadius);
  const reference = (orbitAngle - lpAngle - halfPitchThickness) / toothPitch;
  const firstTooth = Math.floor(reference) - 2;
  const lastTooth = Math.ceil(reference) + 2;
  const baseRadiusInvolute = baseRadius;
  const candidates: THREE.Vector2[] = [];
  for (let tooth = firstTooth; tooth <= lastTooth; tooth += 1) {
    const t =
      baseRadiusInvolute *
      (lpAngle - orbitAngle + halfPitchThickness + tooth * toothPitch);
    const point = pitchPoint.clone().addScaledVector(normal, t);
    if (
      point.length() >= baseRadius - 1e-9 &&
      point.length() <= tipRadius + 1e-9
    )
      candidates.push(point);
  }
  return candidates;
}

function internalMeshContactCandidates(ringAngle: number, orbitAngle: number) {
  const pitchRadius = GEAR.ringPitchRadius;
  const baseRadius = pitchRadius * Math.cos(GEAR.transversePressureAngle);
  const tipRadius = pitchRadius - GEAR.module;
  const rootRadius = pitchRadius + 1.25 * GEAR.module;
  const halfPitchThickness = Math.PI / (2 * GEAR.Zr);
  const toothPitch = (2 * Math.PI) / GEAR.Zr;
  const radial = polarPoint(1, orbitAngle);
  const tangent = new THREE.Vector2(-radial.y, radial.x);
  const normal = radial
    .clone()
    .multiplyScalar(-Math.sin(GEAR.transversePressureAngle))
    .add(
      tangent.clone().multiplyScalar(Math.cos(GEAR.transversePressureAngle)),
    );
  const pitchPoint = radial.clone().multiplyScalar(pitchRadius);
  const reference = (orbitAngle - ringAngle - halfPitchThickness) / toothPitch;
  const firstTooth = Math.floor(reference) - 2;
  const lastTooth = Math.ceil(reference) + 2;
  const candidates: THREE.Vector2[] = [];
  for (let tooth = firstTooth; tooth <= lastTooth; tooth += 1) {
    const t =
      baseRadius *
      (ringAngle - orbitAngle + halfPitchThickness + tooth * toothPitch);
    const point = pitchPoint.clone().addScaledVector(normal, t);
    const ringRadius = point.length();
    if (ringRadius >= tipRadius - 1e-9 && ringRadius <= rootRadius + 1e-9)
      candidates.push(point);
  }
  return candidates;
}

void test('illustrative gear dimensions satisfy planetary closure', () => {
  assert.deepEqual(
    [GEAR.Zs, GEAR.Zp, GEAR.Zr, GEAR.starCount],
    [30, 30, 90, 5],
  );
  assert.equal(GEAR.Zr, GEAR.Zs + 2 * GEAR.Zp);
  assert.ok(
    Math.abs(GEAR.sunStarCenterDistance - GEAR.starRingCenterDistance) < 1e-15,
  );
  assert.equal((GEAR.Zs + GEAR.Zr) / GEAR.starCount, 24);
  assert.equal((GEAR.Zs + GEAR.Zp) / GEAR.starCount, 12);
  assert.equal(GEAR.ratio, 3);
  assert.equal(GEAR.backlash, 0);
  assert.equal(GEAR.contactMode, 'zero-backlash-ideal-rigid-contact');
});

void test('external and internal profiles contain sampled involute flanks', () => {
  const options = { samplesPerFlank: 12, samplesPerTip: 3, samplesPerRoot: 3 };
  const external = gearProfile(GEAR.Zs, false, options);
  const internal = gearProfile(GEAR.Zr, true, options);
  const externalRadii = external.map((point) => point.length());
  const internalRadii = internal.map((point) => point.length());
  assert.ok(Math.min(...externalRadii) < GEAR.sunPitchRadius);
  assert.ok(Math.max(...externalRadii) > GEAR.sunPitchRadius);
  assert.ok(Math.min(...internalRadii) < GEAR.ringPitchRadius);
  assert.ok(Math.max(...internalRadii) > GEAR.ringPitchRadius);

  // First external left flank runs base -> tip and narrows in angular width.
  const externalFlank = external.slice(2, 14);
  assert.ok(
    toothOffset(Math.atan2(externalFlank[0].y, externalFlank[0].x), GEAR.Zs) >
      toothOffset(
        Math.atan2(externalFlank.at(-1)!.y, externalFlank.at(-1)!.x),
        GEAR.Zs,
      ),
  );

  // First internal left flank runs root -> tip and grows in angular width
  // toward the ring root, which distinguishes it from a reflected external
  // outline.
  const internalFlank = internal.slice(1, 13);
  const internalRootOffset = toothOffset(
    Math.atan2(internal[0].y, internal[0].x),
    GEAR.Zr,
  );
  const internalTipOffset = toothOffset(
    Math.atan2(internalFlank.at(-1)!.y, internalFlank.at(-1)!.x),
    GEAR.Zr,
  );
  assert.ok(internalRootOffset > internalTipOffset);
  assert.ok(
    internalFlank.every(
      (point) => point.length() >= Math.min(...internalRadii) - 1e-9,
    ),
  );
});

void test('actual generated profiles stay nonpenetrating at all five contacts for one LP cycle', () => {
  const external = gearProfile(GEAR.Zp, false);
  const ring = gearProfile(GEAR.Zr, true);
  const sampleCount = 720;
  for (let starIndex = 0; starIndex < GEAR.starCount; starIndex += 1) {
    const orbitAngle = (2 * Math.PI * starIndex) / GEAR.starCount;
    for (let sample = 0; sample <= sampleCount; sample += 1) {
      const lpAngle = (2 * Math.PI * sample) / sampleCount;
      const angles = deriveGearAngles(lpAngle);
      const sunBoundary = rayBoundary(external, orbitAngle - angles.sun, false);
      const starSunBoundary = rayBoundary(
        external,
        orbitAngle + Math.PI - angles.stars[starIndex],
        false,
      );
      const starRingBoundary = rayBoundary(
        external,
        orbitAngle - angles.stars[starIndex],
        false,
      );
      const ringBoundary = rayBoundary(ring, orbitAngle - angles.ring, true);
      assert.ok(
        sunBoundary + starSunBoundary <= GEAR.sunStarCenterDistance + 1e-7,
        `sun/star penetration at star ${starIndex}, sample ${sample}`,
      );
      assert.ok(
        GEAR.starRingCenterDistance + starRingBoundary <= ringBoundary + 1e-7,
        `star/ring penetration at star ${starIndex}, sample ${sample}`,
      );
    }
  }
});

void test('actual mesh chords stay close to theoretical pitch contact flanks', () => {
  const gearbox = createGearbox({ helixSlices: 4 });
  const halfMesh = (gear: THREE.Group, side: 'left' | 'right') =>
    gear.children.find(
      (child) =>
        child.userData.component === 'double-helical-half' &&
        child.userData.side === side,
    ) as THREE.Mesh;
  const cases = [
    { gear: gearbox.sun, teeth: GEAR.Zs, internal: false, toothCenter: 0 },
    {
      gear: gearbox.stars[0],
      teeth: GEAR.Zp,
      internal: false,
      toothCenter: Math.PI,
    },
    { gear: gearbox.ring, teeth: GEAR.Zr, internal: true, toothCenter: 0 },
  ];

  for (const side of [-1, 1] as const) {
    for (const item of cases) {
      const gearMesh = halfMesh(item.gear, 'left');
      const slice = 0;
      const polygon = meshSlicePolygon(item.gear, gearMesh, slice);
      const pitchRadius = (GEAR.module * item.teeth) / 2;
      const localPoint = theoreticalFlankPoint(
        item.teeth,
        item.internal,
        pitchRadius,
        side,
        item.toothCenter,
      ).rotateAround(
        new THREE.Vector2(),
        meshSliceAngle(item.gear, gearMesh, slice, pitchRadius),
      );
      const expected = localPoint.add(
        new THREE.Vector2(item.gear.position.y, item.gear.position.z),
      );
      const tessellationError = pointToPolygonDistance(expected, polygon);
      assert.ok(
        tessellationError <= MAX_TESSELLATION_ERROR,
        `${item.gear.userData.gearId} ${side > 0 ? 'right' : 'left'} flank tessellation error ${tessellationError} m`,
      );
    }
  }
});

void test('actual helical mesh slices have no 2D vertex or edge penetration', () => {
  const gearbox = createGearbox({ helixSlices: 4 });
  const halfMesh = (gear: THREE.Group, side: 'left' | 'right') =>
    gear.children.find(
      (child) =>
        child.userData.component === 'double-helical-half' &&
        child.userData.side === side,
    ) as THREE.Mesh;
  const sliceCount = 4;
  // 61 is incommensurate with the 30-tooth pitch, so the samples cover many
  // fractional tooth phases instead of repeating only 0 and half a pitch.
  const lpSamples = 61;

  for (let sample = 0; sample < lpSamples; sample += 1) {
    const lpAngle = (2 * Math.PI * sample) / lpSamples;
    gearbox.setAngle(lpAngle);
    for (const side of ['left', 'right'] as const) {
      const sunMesh = halfMesh(gearbox.sun, side);
      const ringMesh = halfMesh(gearbox.ring, side);
      const starMeshes = gearbox.stars.map((star) => halfMesh(star, side));
      for (let slice = 0; slice <= sliceCount; slice += 1) {
        const sunPolygon = meshSlicePolygon(gearbox.sun, sunMesh, slice);
        const ringPolygon = meshSlicePolygon(gearbox.ring, ringMesh, slice);
        const sunIndex = indexPolygon(sunPolygon);
        const ringEdges = indexEdges(ringPolygon);
        const ringRadialIndex = indexRadialBoundary(ringPolygon);
        for (let starIndex = 0; starIndex < GEAR.starCount; starIndex += 1) {
          const star = gearbox.stars[starIndex];
          const starPolygon = meshSlicePolygon(
            star,
            starMeshes[starIndex],
            slice,
          );
          const starIndexLookup = indexPolygon(starPolygon);
          const starCenter = new THREE.Vector2(
            star.position.y,
            star.position.z,
          );
          const starRadialIndex = indexRadialBoundary(
            starPolygon.map((point) => point.clone().sub(starCenter)),
          );
          const orbitAngle = star.userData.orbitAngle as number;
          const contactCandidates = externalMeshContactCandidates(
            meshSliceAngle(gearbox.sun, sunMesh, slice, GEAR.sunPitchRadius),
            orbitAngle,
          );
          const pairContactError = Math.min(
            ...contactCandidates.map((point) =>
              Math.max(
                pointToPolygonDistance(point, sunPolygon),
                pointToPolygonDistance(point, starPolygon),
              ),
            ),
          );
          assert.ok(
            pairContactError <= MAX_TESSELLATION_ERROR,
            `sun/star theoretical contact error ${pairContactError} m at star ${starIndex}, side ${side}, sample ${sample}, slice ${slice}`,
          );

          const internalContactCandidates = internalMeshContactCandidates(
            meshSliceAngle(gearbox.ring, ringMesh, slice, GEAR.ringPitchRadius),
            orbitAngle,
          );
          const internalPairContactError = Math.min(
            ...internalContactCandidates.map((point) =>
              Math.max(
                pointToPolygonDistance(point, ringPolygon),
                pointToPolygonDistance(point, starPolygon),
              ),
            ),
          );
          assert.ok(
            internalPairContactError <= MAX_TESSELLATION_ERROR,
            `star/ring theoretical contact error ${internalPairContactError} m at star ${starIndex}, side ${side}, sample ${sample}, slice ${slice}`,
          );

          assert.equal(
            sunPolygon.some((point) =>
              indexedStrictInside(point, starIndexLookup),
            ),
            false,
            `sun vertex inside star ${starIndex}, side ${side}, sample ${sample}, slice ${slice}`,
          );
          assert.equal(
            starPolygon.some((point) => indexedStrictInside(point, sunIndex)),
            false,
            `star vertex inside sun ${starIndex}, side ${side}, sample ${sample}, slice ${slice}`,
          );
          const starEdges = indexEdges(starPolygon);
          const sunStarEdgeDepth = polygonEdgesIntersect(sunPolygon, starEdges);
          assert.ok(
            sunStarEdgeDepth <= MAX_TESSELLATION_ERROR,
            `sun/star edge penetration ${sunStarEdgeDepth} m at star ${starIndex}, side ${side}, sample ${sample}, slice ${slice}`,
          );

          const starOutsideRing = maximumSolidPenetration(
            starPolygon,
            new THREE.Vector2(),
            ringRadialIndex,
            true,
          );
          assert.ok(
            starOutsideRing <= MAX_TESSELLATION_ERROR,
            `star/ring vertex penetration ${starOutsideRing} m at star ${starIndex}, side ${side}, sample ${sample}, slice ${slice}`,
          );
          const ringInsideStar = maximumSolidPenetration(
            ringPolygon,
            starCenter,
            starRadialIndex,
            false,
          );
          assert.ok(
            ringInsideStar <= MAX_TESSELLATION_ERROR,
            `ring/star vertex penetration ${ringInsideStar} m at star ${starIndex}, side ${side}, sample ${sample}, slice ${slice}`,
          );
          const starRingEdgeDepth = polygonEdgesIntersect(
            starPolygon,
            ringEdges,
          );
          assert.ok(
            starRingEdgeDepth <= MAX_TESSELLATION_ERROR,
            `star/ring edge penetration ${starRingEdgeDepth} m at star ${starIndex}, side ${side}, sample ${sample}, slice ${slice}`,
          );
        }
      }
    }
  }
});

void test('zero-backlash idealized line-of-action contact has normal closure', () => {
  const pressure = GEAR.transversePressureAngle;
  const idealizedOptions = {
    backlash: 0,
    samplesPerFlank: 64,
    samplesPerTip: 4,
    samplesPerRoot: 4,
  };
  const idealizedSun = gearProfile(GEAR.Zs, false, idealizedOptions);
  const idealizedRing = gearProfile(GEAR.Zr, true, idealizedOptions);
  const profileNormal = new THREE.Vector2(
    Math.sin(pressure),
    Math.cos(pressure),
  );
  assert.ok(
    flankNormalAlignment(idealizedSun, GEAR.sunPitchRadius, profileNormal) >
      0.995,
  );
  assert.ok(
    flankNormalAlignment(idealizedRing, GEAR.ringPitchRadius, profileNormal) >
      0.995,
  );
  const sunOmega = 1;
  const starOmega = -(GEAR.Zs / GEAR.Zp);
  const ringOmega = -(GEAR.Zs / GEAR.Zr);
  for (const orbitAngle of Array.from(
    { length: 5 },
    (_, index) => (2 * Math.PI * index) / 5,
  )) {
    const radial = new THREE.Vector2(
      Math.cos(orbitAngle),
      Math.sin(orbitAngle),
    );
    const tangent = new THREE.Vector2(-radial.y, radial.x);
    const normal = radial
      .clone()
      .multiplyScalar(Math.sin(pressure))
      .add(tangent.clone().multiplyScalar(Math.cos(pressure)));
    const lineTangent = new THREE.Vector2(-normal.y, normal.x);
    const internalNormal = radial
      .clone()
      .multiplyScalar(-Math.sin(pressure))
      .addScaledVector(tangent, Math.cos(pressure));
    const internalTangent = new THREE.Vector2(
      -internalNormal.y,
      internalNormal.x,
    );
    const velocityAt = (omega: number, point: THREE.Vector2) =>
      new THREE.Vector2(-omega * point.y, omega * point.x);
    // The visual gearbox uses this same zero-backlash ideal rigid contact mode.
    for (const offset of [-0.006, 0, 0.006]) {
      const sunContact = radial
        .clone()
        .multiplyScalar(GEAR.sunPitchRadius)
        .addScaledVector(normal, offset);
      const starContactFromSun = radial
        .clone()
        .multiplyScalar(GEAR.sunStarCenterDistance)
        .multiplyScalar(-1)
        .add(sunContact);
      const sunRelative = velocityAt(sunOmega, sunContact);
      const starAtSun = velocityAt(starOmega, starContactFromSun);
      const externalRelative = sunRelative.clone().sub(starAtSun);
      if (offset === 0) {
        assert.ok(externalRelative.length() < 1e-12);
      } else {
        assert.ok(Math.abs(externalRelative.dot(normal)) < 1e-12);
        assert.ok(Math.abs(externalRelative.dot(lineTangent)) > 1e-5);
      }

      const ringContact = radial
        .clone()
        .multiplyScalar(GEAR.ringPitchRadius)
        .addScaledVector(internalNormal, offset);
      const starContactFromRing = radial
        .clone()
        .multiplyScalar(GEAR.starRingCenterDistance)
        .multiplyScalar(-1)
        .add(ringContact);
      const ringAtContact = velocityAt(ringOmega, ringContact);
      const starAtRing = velocityAt(starOmega, starContactFromRing);
      const internalRelative = ringAtContact.clone().sub(starAtRing);
      if (offset === 0) {
        assert.ok(internalRelative.length() < 1e-12);
      } else {
        assert.ok(Math.abs(internalRelative.dot(internalNormal)) < 1e-12);
        assert.ok(Math.abs(internalRelative.dot(internalTangent)) > 1e-5);
      }
    }
  }
});

void test('gearbox exposes fixed support, attachable shafts, mesh transforms and helix phase', () => {
  const gearbox = createGearbox({ highlightTooth: 4, helixSlices: 4 });
  assert.equal(gearbox.stars.length, 5);
  assert.equal(gearbox.group.children.includes(gearbox.carrier), true);
  assert.equal(gearbox.group.children.includes(gearbox.ring), true);
  assert.equal(gearbox.inputShaft.parent, gearbox.sun);
  assert.equal(gearbox.outputShaft.parent, gearbox.ring);
  assert.equal(gearbox.sun.userData.boreRadius, GEAR.sunBoreRadius);
  assert.equal(gearbox.stars[0].userData.boreRadius, GEAR.starBoreRadius);
  assert.equal(gearbox.inputShaft.userData.radius, GEAR.inputShaftRadius);
  assert.ok(
    Math.abs((gearbox.inputShaft.userData.xStart as number) - -0.02) < 1e-12,
  );
  assert.ok(
    Math.abs((gearbox.inputShaft.userData.xEnd as number) - 0.22) < 1e-12,
  );
  assert.equal(gearbox.outputShaft.userData.radius, GEAR.outputShaftRadius);
  assert.ok(
    Math.abs((gearbox.outputShaft.userData.xStart as number) - -0.22) < 1e-12,
  );
  assert.ok(
    Math.abs((gearbox.outputShaft.userData.xEnd as number) - -0.05) < 1e-12,
  );
  const inputSleeve = gearbox.sun.children.find(
    (child) => child.userData.component === 'input-spline-sleeve',
  );
  assert.equal(inputSleeve?.userData.innerRadius, GEAR.inputShaftRadius);
  assert.equal(inputSleeve?.userData.outerRadius, GEAR.sunBoreRadius);
  const journalSleeve = gearbox.stars[0].children.find(
    (child) => child.userData.component === 'journal-sleeve',
  );
  assert.equal(journalSleeve?.userData.innerRadius, GEAR.journalPinRadius);
  assert.equal(journalSleeve?.userData.outerRadius, GEAR.starBoreRadius);
  assert.equal(
    gearbox.carrier.children.filter(
      (child) => child.userData.component === 'journal-pin',
    ).length,
    5,
  );
  assert.equal(
    gearbox.carrier.children.filter(
      (child) => child.userData.component === 'carrier-spoke',
    ).length,
    5,
  );
  const carrierHub = gearbox.carrier.children.find(
    (child) => child.userData.component === 'fixed-hub',
  );
  assert.equal(carrierHub?.userData.boreRadius, GEAR.carrierHubBoreRadius);
  assert.ok(
    Math.abs(
      (gearbox.carrier.userData.supportX as number) -
        (GEAR.faceWidth / 2 + 0.006),
    ) < 1e-12,
  );
  assert.ok(
    Math.abs(
      (carrierHub?.userData.xStart as number) - (GEAR.faceWidth / 2 + 0.004),
    ) < 1e-12,
  );
  assert.ok(
    Math.abs(
      (carrierHub?.userData.xEnd as number) - (GEAR.faceWidth / 2 + 0.008),
    ) < 1e-12,
  );
  const journalPin = gearbox.carrier.children.find(
    (child) => child.userData.component === 'journal-pin',
  );
  assert.ok(
    Math.abs((journalPin?.userData.xStart as number) - -GEAR.faceWidth / 2) <
      1e-12,
  );
  assert.ok(
    Math.abs(
      (journalPin?.userData.xEnd as number) - (GEAR.faceWidth / 2 + 0.008),
    ) < 1e-12,
  );
  const outputDrum = gearbox.ring.children.find(
    (child) => child.userData.component === 'output-drum',
  );
  assert.equal(outputDrum?.userData.radiusAtShaft, GEAR.outputShaftRadius);

  const lpAngle = 1.234;
  gearbox.setAngle(lpAngle);
  const angles = deriveGearAngles(lpAngle);
  assert.equal(gearbox.sun.rotation.x, angles.sun);
  assert.deepEqual(
    gearbox.stars.map((star) => star.rotation.x),
    angles.stars,
  );
  assert.equal(gearbox.ring.rotation.x, angles.ring);
  assert.equal(gearbox.carrier.rotation.x, 0);
  assert.equal(gearbox.sun.userData.highlightedTooth, 4);
  gearbox.setRotationIndex(-1);
  assert.equal(gearbox.sun.userData.highlightedTooth, GEAR.Zs - 1);

  const half = (gear: THREE.Group) =>
    gear.children.find(
      (child) =>
        child.userData.component === 'double-helical-half' &&
        child.userData.side === 'right',
    ) as THREE.Mesh;
  const sunHalf = half(gearbox.sun);
  const starHalf = half(gearbox.stars[0]);
  const ringHalf = half(gearbox.ring);
  assert.equal(sunHalf.userData.helixSlope, 1);
  assert.equal(starHalf.userData.helixSlope, -1);
  assert.equal(ringHalf.userData.helixSlope, -1);

  const phaseFromMesh = (mesh: THREE.Mesh) => {
    const vertexStride = mesh.userData.vertexStride as number;
    const slices = 4;
    const positions = mesh.geometry.getAttribute('position');
    const angleAt = (slice: number) => {
      const index = slice * vertexStride;
      return Math.atan2(positions.getZ(index), positions.getY(index));
    };
    return wrap(angleAt(slices) - angleAt(0));
  };
  const expectedSunPhase =
    (sunHalf.userData.helixSlope *
      Math.tan(GEAR.helixAngle) *
      (sunHalf.userData.xEnd - sunHalf.userData.xStart)) /
    GEAR.sunPitchRadius;
  assert.ok(Math.abs(phaseFromMesh(sunHalf) - expectedSunPhase) < 1e-5);
  assert.ok(
    Math.sign(phaseFromMesh(starHalf)) === -Math.sign(phaseFromMesh(sunHalf)),
  );
  assert.ok(
    Math.sign(phaseFromMesh(ringHalf)) === Math.sign(phaseFromMesh(starHalf)),
  );
});
