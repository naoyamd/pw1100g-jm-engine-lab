import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createEngineGeometry,
  type EngineGeometryResult,
} from '../lib/engine-geometry.ts';

const ROTOR_ROLES = new Set(['rotor-blade', 'rotor-disk', 'rotor-hub']);
const ROTOR_BLADE_ROLES = new Set(['rotor-blade']);
const STATIONARY_ROLES = new Set([
  'stator-vane',
  'stator-inner-platform',
  'stator-outer-platform',
  'structural-guide-vane',
]);
const STATIONARY_BLADE_ROLES = new Set([
  'stator-vane',
  'structural-guide-vane',
]);
const OVERLAP_EPSILON = 1e-7;
const PHASE_EPSILON = 1e-5;
const MAX_BLADE_PITCH_FRACTION = 0.75;
// The finite NACA trailing edge offsets the endpoint chord from its centreline.
const METAL_ANGLE_TOLERANCE = 0.002;

interface Envelope {
  xMin: number;
  xMax: number;
  radiusMin: number;
  radiusMax: number;
}

interface RotorRowEnvelope {
  id: string;
  family: string;
  envelope: Envelope;
  bladeEnvelope: Envelope;
  hubWebEnvelope: Envelope;
}

function findObject(root: THREE.Object3D, name: string): THREE.Object3D {
  const found = root.getObjectByName(name);
  if (!found) throw new Error(`missing generated object ${name}`);
  return found;
}

function meshesWithRoles(
  root: THREE.Object3D,
  roles: ReadonlySet<string>,
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && roles.has(String(child.userData.role))) {
      meshes.push(child);
    }
  });
  return meshes;
}

function meshEnvelope(meshes: readonly THREE.Mesh[]): Envelope {
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let radiusMin = Number.POSITIVE_INFINITY;
  let radiusMax = Number.NEGATIVE_INFINITY;
  const point = new THREE.Vector3();

  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      const radius = Math.hypot(point.y, point.z);
      xMin = Math.min(xMin, point.x);
      xMax = Math.max(xMax, point.x);
      radiusMin = Math.min(radiusMin, radius);
      radiusMax = Math.max(radiusMax, radius);
    }
  }

  assert.ok(Number.isFinite(xMin), 'generated role meshes have vertices');
  assert.ok(Number.isFinite(xMax));
  assert.ok(Number.isFinite(radiusMin));
  assert.ok(Number.isFinite(radiusMax));
  return { xMin, xMax, radiusMin, radiusMax };
}

function angularWidth(mesh: THREE.Mesh): number {
  const position = mesh.geometry.getAttribute('position');
  const point = new THREE.Vector3();
  let reference = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
    const angle = Math.atan2(point.z, point.y);
    if (index === 0) reference = angle;
    let delta = angle - reference;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    minimum = Math.min(minimum, delta);
    maximum = Math.max(maximum, delta);
  }
  assert.ok(Number.isFinite(minimum), 'blade mesh has radial vertices');
  return maximum - minimum;
}

function assertBladePitchClearance(
  root: THREE.Object3D,
  roles: ReadonlySet<string>,
  label: string,
): void {
  const blades = meshesWithRoles(root, roles).filter(
    (mesh) => typeof mesh.userData.bladeIndex === 'number',
  );
  assert.ok(blades.length > 0, `${label} has repeated blade meshes`);
  const pitchAngle = (Math.PI * 2) / blades.length;
  const maximumWidth = Math.max(...blades.map((blade) => angularWidth(blade)));
  assert.ok(
    maximumWidth <= pitchAngle * MAX_BLADE_PITCH_FRACTION,
    `${label} blade angular width ${maximumWidth} must stay below ` +
      `${MAX_BLADE_PITCH_FRACTION} pitch (${pitchAngle})`,
  );
}

function overlapsInAxialAndRadialEnvelope(
  left: Envelope,
  right: Envelope,
): boolean {
  return (
    Math.min(left.xMax, right.xMax) - Math.max(left.xMin, right.xMin) >
      OVERLAP_EPSILON &&
    Math.min(left.radiusMax, right.radiusMax) -
      Math.max(left.radiusMin, right.radiusMin) >
      OVERLAP_EPSILON
  );
}

function assertSamePhaseEnvelope(
  reference: Envelope,
  candidate: Envelope,
  label: string,
): void {
  for (const key of ['xMin', 'xMax', 'radiusMin', 'radiusMax'] as const) {
    assert.ok(
      Math.abs(reference[key] - candidate[key]) <= PHASE_EPSILON,
      `${label} ${key} changed with rotation phase`,
    );
  }
}

function assertRepeatedPhaseGeometry(
  root: THREE.Object3D,
  roles: ReadonlySet<string>,
  label: string,
): void {
  const byRole = new Map<string, Envelope>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const role = String(child.userData.role);
    if (!roles.has(role) || typeof child.userData.bladeIndex !== 'number')
      return;
    const envelope = meshEnvelope([child]);
    const reference = byRole.get(role);
    if (reference) {
      assertSamePhaseEnvelope(reference, envelope, `${label}/${role}`);
    } else {
      byRole.set(role, envelope);
    }
  });
}

function buildEnvelopes(engine: EngineGeometryResult) {
  const rotorRows = engine.stages.map((stage) => {
    const group = findObject(engine.group, `${stage.id}-rotor`);
    const meshes = meshesWithRoles(group, ROTOR_ROLES);
    const bladeMeshes = meshesWithRoles(group, new Set(['rotor-blade']));
    const hubWebMeshes = meshesWithRoles(
      group,
      new Set(['rotor-disk', 'rotor-hub']),
    );
    assert.ok(meshes.length > 0, `${stage.id} rotor has role meshes`);
    assert.ok(bladeMeshes.length > 0, `${stage.id} rotor has blades`);
    assert.ok(hubWebMeshes.length > 0, `${stage.id} rotor has hub/web`);
    assertRepeatedPhaseGeometry(group, ROTOR_ROLES, stage.id);
    assertBladePitchClearance(group, ROTOR_BLADE_ROLES, stage.id);
    return {
      id: stage.id,
      family: stage.family,
      envelope: meshEnvelope(meshes),
      bladeEnvelope: meshEnvelope(bladeMeshes),
      hubWebEnvelope: meshEnvelope(hubWebMeshes),
    } satisfies RotorRowEnvelope;
  });
  const stationaryRows = engine.stationary.children
    .filter((child) => {
      const role = child.userData.role;
      return role === 'stator-row' || role === 'structural-guide-vane-row';
    })
    .map((group) => {
      const id = String(group.userData.stageId ?? group.name);
      const meshes = meshesWithRoles(group, STATIONARY_ROLES);
      assert.ok(meshes.length > 0, `${id} stationary row has role meshes`);
      assertRepeatedPhaseGeometry(group, STATIONARY_ROLES, id);
      assertBladePitchClearance(group, STATIONARY_BLADE_ROLES, id);
      return { id, envelope: meshEnvelope(meshes) };
    });

  assert.equal(rotorRows.length, 17, 'one rotor envelope per stage');
  assert.equal(
    stationaryRows.length,
    17,
    'front guide row plus one stationary row per non-fan stage',
  );
  return { rotorRows, stationaryRows };
}

function assertNoEnvelopeOverlap(
  rotorRows: ReadonlyArray<RotorRowEnvelope>,
  stationaryRows: ReadonlyArray<{ id: string; envelope: Envelope }>,
): void {
  for (const rotor of rotorRows) {
    for (const stationary of stationaryRows) {
      assert.equal(
        overlapsInAxialAndRadialEnvelope(rotor.envelope, stationary.envelope),
        false,
        `${rotor.id} overlaps stationary ${stationary.id} in x/r envelope`,
      );
    }
  }

  for (let leftIndex = 0; leftIndex < rotorRows.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < rotorRows.length;
      rightIndex += 1
    ) {
      const left = rotorRows[leftIndex];
      const right = rotorRows[rightIndex];
      assert.equal(
        rotorPairOverlaps(left, right),
        false,
        `${left.id} overlaps different rotor ${right.id} in x/r envelope`,
      );
    }
  }
}

function rotationGroup(family: string): 'fan' | 'lp' | 'hp' {
  if (family === 'fan') return 'fan';
  if (family === 'hpc' || family === 'hpt') return 'hp';
  return 'lp';
}

function rotorPairOverlaps(
  left: RotorRowEnvelope,
  right: RotorRowEnvelope,
): boolean {
  if (rotationGroup(left.family) !== rotationGroup(right.family)) {
    return overlapsInAxialAndRadialEnvelope(left.envelope, right.envelope);
  }
  // Same-spool hub/web contact is a permitted mechanical connection. Any
  // overlap involving a blade remains invalid and is checked in both
  // directions.
  return (
    overlapsInAxialAndRadialEnvelope(left.bladeEnvelope, right.bladeEnvelope) ||
    overlapsInAxialAndRadialEnvelope(
      left.bladeEnvelope,
      right.hubWebEnvelope,
    ) ||
    overlapsInAxialAndRadialEnvelope(right.bladeEnvelope, left.hubWebEnvelope)
  );
}

function assertEnvelopeSetSame(
  expected: ReturnType<typeof buildEnvelopes>,
  actual: ReturnType<typeof buildEnvelopes>,
  label: string,
): void {
  assert.equal(actual.rotorRows.length, expected.rotorRows.length);
  assert.equal(actual.stationaryRows.length, expected.stationaryRows.length);
  for (let index = 0; index < expected.rotorRows.length; index += 1) {
    assert.equal(actual.rotorRows[index].id, expected.rotorRows[index].id);
    assertSamePhaseEnvelope(
      expected.rotorRows[index].envelope,
      actual.rotorRows[index].envelope,
      `${label}/${expected.rotorRows[index].id}/rotor`,
    );
  }
  for (let index = 0; index < expected.stationaryRows.length; index += 1) {
    assert.equal(
      actual.stationaryRows[index].id,
      expected.stationaryRows[index].id,
    );
    assertSamePhaseEnvelope(
      expected.stationaryRows[index].envelope,
      actual.stationaryRows[index].envelope,
      `${label}/${expected.stationaryRows[index].id}/stationary`,
    );
  }
}

function sectionChordAngle(mesh: THREE.Mesh, radius: number): number {
  const position = mesh.geometry.getAttribute('position');
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(position, i);
    if (Math.abs(point.y - radius) < 1e-6) points.push(point);
  }
  assert.ok(points.length > 2, 'airfoil root/tip section exists');
  // For these thin closed airfoils, the farthest boundary pair is the chord.
  // Recover it from actual coordinates, independently of stored metadata.
  let distance = 0;
  const chord = new THREE.Vector3();
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const d = points[i].distanceToSquared(points[j]);
      if (d > distance) {
        distance = d;
        chord.subVectors(points[j], points[i]);
      }
    }
  if (chord.x < 0) chord.negate();
  return Math.atan2(chord.z, chord.x);
}

void test('uses design-point angle means and the correct world direction for actual metal', () => {
  const engine = createEngineGeometry();
  for (const stage of engine.stages) {
    const rotor = meshesWithRoles(
      findObject(engine.group, `${stage.id}-rotor`),
      ROTOR_BLADE_ROLES,
    )[0];
    const statorRow = findObject(
      engine.stationary,
      stage.family === 'fan' ? 'front-sgv-stator' : `${stage.id}-stator`,
    );
    const stator = meshesWithRoles(statorRow, STATIONARY_BLADE_ROLES)[0];
    const sign = stage.family === 'fan' ? -1 : 1;
    for (const [index, radius] of [
      [0, stage.hubRadius],
      [2, stage.tipRadius],
    ] as const) {
      const triangle = stage.velocityTriangles[index];
      assert.ok(
        Math.abs(
          sectionChordAngle(rotor, radius) - sign * triangle.rotorStagger,
        ) < METAL_ANGLE_TOLERANCE,
        `${stage.id} actual rotor chord has its design angle and rotation sense`,
      );
    }
    // Guide vanes have their own span; recover their root from the mesh.
    stator.geometry.computeBoundingBox();
    assert.ok(
      Math.abs(
        sectionChordAngle(stator, stator.geometry.boundingBox!.min.y) -
          sign * stage.velocityTriangles[0].statorStagger,
      ) < METAL_ANGLE_TOLERANCE,
      `${stage.id} actual stator chord has the signed absolute-flow design angle`,
    );
    for (const triangle of stage.velocityTriangles) {
      assert.ok(
        Math.abs(
          triangle.rotorStagger -
            (triangle.relativeInletAngle + triangle.relativeOutletAngle) / 2,
        ) < 1e-12,
        `${stage.id} rotor stagger follows its velocity triangle`,
      );
      assert.ok(
        Math.abs(
          triangle.statorStagger -
            (triangle.inletAngle + triangle.outletAngle) / 2,
        ) < 1e-12,
        `${stage.id} stator stagger follows its velocity triangle`,
      );
    }
  }

  const hpc = engine.stages.filter((stage) => stage.family === 'hpc');
  assert.ok(
    hpc.every((stage) =>
      stage.velocityTriangles.every(
        (triangle) => triangle.rotorStagger < -1.15,
      ),
    ),
    'HPC rotor design angles are no longer silently clamped',
  );
  assert.ok(
    hpc.every((stage) =>
      stage.velocityTriangles.every(
        (triangle) => triangle.statorStagger > 1.15,
      ),
    ),
    'HPC stator design angles are no longer silently clamped',
  );
});

void test('keeps generated rows separated in x/r and below angular pitch', () => {
  const engine = createEngineGeometry();
  const phases = [
    [0, 0],
    [0.37, -0.61],
    [Math.PI, Math.PI / 2],
    [-2.4, 2.1],
  ] as const;
  let reference: ReturnType<typeof buildEnvelopes> | undefined;

  // Every spool transform is a rotation around +X, which preserves x and
  // radius continuously. Sample distinct phases to guard that invariant and
  // then apply the same envelope check at every sampled phase.
  for (const [lpAngle, hpAngle] of phases) {
    engine.setAngles(lpAngle, hpAngle);
    engine.group.updateMatrixWorld(true);
    const envelopes = buildEnvelopes(engine);
    assertNoEnvelopeOverlap(envelopes.rotorRows, envelopes.stationaryRows);
    if (reference) {
      assertEnvelopeSetSame(
        reference,
        envelopes,
        `phase ${lpAngle}/${hpAngle}`,
      );
    } else {
      reference = envelopes;
    }
  }
});
